export const MIN_STRUK = 50;
export const MIN_MENU = 2;
export const MIN_BERSAMA = 5;
export const MIN_CONF = 0.25;
export const MIN_TANPA = 3;
export const JARANG_EXPECTED = 5;
export const MENU_BARU_HARI = 14;
export const PERIODE_DEFAULT = 60;
export const SKENARIO_PERSEN = 10;
export const WARN_MULTI_PCT = 15;

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function buildBaskets(receipts, validMenuIds, start, end) {
  const validIds =
    validMenuIds instanceof Set ? validMenuIds : new Set(validMenuIds || []);
  const baskets = [];
  (receipts || []).forEach((receipt) => {
    if (!receipt.date || receipt.date < start || receipt.date > end) return;
    const ids = new Set();
    (receipt.items || []).forEach((item) => {
      const id = item?.menuId;
      if (id !== null && id !== undefined && id !== "" && validIds.has(id)) {
        ids.add(id);
      }
    });
    if (ids.size) baskets.push([...ids]);
  });
  return baskets;
}

export function countBaskets(baskets) {
  const countByMenu = new Map();
  const countByPair = new Map();
  let multiItemReceipts = 0;
  let distinctTotal = 0;

  (baskets || []).forEach((basket) => {
    const ids = [...new Set(basket)];
    distinctTotal += ids.length;
    if (ids.length >= 2) multiItemReceipts += 1;
    ids.forEach((id) => {
      countByMenu.set(id, (countByMenu.get(id) || 0) + 1);
    });
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = pairKey(ids[i], ids[j]);
        countByPair.set(key, (countByPair.get(key) || 0) + 1);
      }
    }
  });

  const N = (baskets || []).length;
  return {
    N,
    countByMenu,
    countByPair,
    multiItemReceipts,
    avgDistinct: N ? distinctTotal / N : 0,
  };
}

export function countReceiptPortions(receipts, validMenuIds, start, end) {
  const validIds =
    validMenuIds instanceof Set ? validMenuIds : new Set(validMenuIds || []);
  const portionsWithoutOffer = new Map();
  const offerPortionsInBoth = new Map();

  (receipts || []).forEach((receipt) => {
    if (!receipt.date || receipt.date < start || receipt.date > end) return;
    const portions = new Map();
    (receipt.items || []).forEach((item) => {
      const id = item?.menuId;
      const qty = Number(item?.qty);
      if (
        id === null ||
        id === undefined ||
        id === "" ||
        !validIds.has(id) ||
        !Number.isFinite(qty) ||
        qty <= 0
      ) {
        return;
      }
      portions.set(id, (portions.get(id) || 0) + qty);
    });

    for (const from of portions.keys()) {
      for (const offer of validIds) {
        if (from === offer) continue;
        const key = `${from}>${offer}`;
        if (portions.has(offer)) {
          offerPortionsInBoth.set(
            key,
            (offerPortionsInBoth.get(key) || 0) + portions.get(offer),
          );
        } else {
          portionsWithoutOffer.set(
            key,
            (portionsWithoutOffer.get(key) || 0) + portions.get(from),
          );
        }
      }
    }
  });

  return { portionsWithoutOffer, offerPortionsInBoth };
}

export function analyze(counts, menus) {
  const { N, countByMenu, countByPair, multiItemReceipts, avgDistinct } =
    counts;
  if (N < MIN_STRUK) {
    return { ok: false, reason: "terlalu_sedikit_struk", N };
  }
  if (menus.length < MIN_MENU) {
    return { ok: false, reason: "terlalu_sedikit_menu", N };
  }
  if (multiItemReceipts === 0) {
    return { ok: false, reason: "tidak_ada_struk_multi", N };
  }

  const recs = [];
  const jarang = [];
  for (let i = 0; i < menus.length; i += 1) {
    for (let j = i + 1; j < menus.length; j += 1) {
      const a = menus[i];
      const b = menus[j];
      const nA = countByMenu.get(a.id) || 0;
      const nB = countByMenu.get(b.id) || 0;
      if (nA === 0 || nB === 0) continue;
      const nAB = countByPair.get(pairKey(a.id, b.id)) || 0;
      const pairProduct = nA * nB;
      const lift = (nAB * N) / pairProduct;
      const frequent =
        nAB >= MIN_BERSAMA && 10 * nAB * N >= 12 * pairProduct;
      const rare =
        pairProduct >= JARANG_EXPECTED * N &&
        10 * nAB * N <= 7 * pairProduct;

      if (frequent) {
        for (const [fromMenu, offerMenu, nFrom] of [
          [a, b, nA],
          [b, a, nB],
        ]) {
          const untungOffer = finiteNumber(offerMenu.untungPerPorsi);
          const pairKey = `${fromMenu.id}>${offerMenu.id}`;
          const portionsWithoutOffer =
            counts.portionsWithoutOffer?.get(pairKey) ?? nFrom - nAB;
          const offerPortionsInBoth =
            counts.offerPortionsInBoth?.get(pairKey) ?? nAB;
          if (
            4 * nAB < nFrom ||
            nFrom - nAB < MIN_TANPA ||
            untungOffer <= 0
          ) {
            continue;
          }
          recs.push({
            from: fromMenu.id,
            fromName: fromMenu.name,
            offer: offerMenu.id,
            offerName: offerMenu.name,
            nFrom,
            nBoth: nAB,
            conf: nAB / nFrom,
            lift,
            tanpa: nFrom - nAB,
            portionsWithoutOffer,
            offerPortionsInBoth,
            untungOffer,
            potensi: portionsWithoutOffer * untungOffer,
          });
        }
      }

      if (rare) {
        jarang.push({
          a: a.id,
          aName: a.name,
          b: b.id,
          bName: b.name,
          nA,
          nB,
          nBoth: nAB,
          diharapkan: pairProduct / N,
          lift,
          selisih: pairProduct - nAB * N,
        });
      }
    }
  }

  recs.sort(
    (a, b) =>
      b.potensi - a.potensi ||
      b.conf - a.conf ||
      a.offerName.localeCompare(b.offerName, "id") ||
      a.fromName.localeCompare(b.fromName, "id"),
  );
  jarang.sort(
    (a, b) =>
      b.selisih - a.selisih ||
      a.lift - b.lift ||
      a.aName.localeCompare(b.aName, "id") ||
      a.bName.localeCompare(b.bName, "id"),
  );

  return {
    ok: true,
    N,
    multiItemReceipts,
    sharePctMulti: (multiItemReceipts / N) * 100,
    avgDistinct,
    recs,
    jarang,
  };
}

export function liftLabel(nAB, N, nA, nB) {
  const observed = nAB * N;
  const expected = nA * nB;
  if (observed >= 2 * expected) return "Sangat kuat";
  if (2 * observed >= 3 * expected) return "Kuat";
  return "Cukup";
}

export function simulateOffer({
  nFrom,
  nBoth,
  untungOffer,
  setujuPlainPct,
  hemat,
  setujuBundlePct,
}) {
  const from = Math.max(0, finiteNumber(nFrom));
  const both = Math.max(0, finiteNumber(nBoth));
  const profit = finiteNumber(untungOffer);
  const clampPercent = (value) =>
    Math.min(100, Math.max(0, finiteNumber(value)));
  const discount = Math.max(0, Math.round(finiteNumber(hemat)));
  const tanpa = Math.max(0, from - both);
  const takersPlain = (tanpa * clampPercent(setujuPlainPct)) / 100;
  const tambahPlain = takersPlain * profit;
  if (discount === 0) {
    return { tanpa, takersPlain, tambahPlain, bundle: null };
  }
  if (discount >= profit) {
    return {
      tanpa,
      takersPlain,
      tambahPlain,
      bundle: { valid: false, reason: "hemat_terlalu_besar" },
    };
  }

  const takersBundle = (tanpa * clampPercent(setujuBundlePct)) / 100;
  const tambahBaru = takersBundle * (profit - discount);
  const biayaLama = both * discount;
  const tambahBundle = tambahBaru - biayaLama;
  const takersImpas = biayaLama / (profit - discount);
  const persenImpas = tanpa > 0 ? (takersImpas / tanpa) * 100 : null;
  const setujuBundleMinPct =
    tanpa > 0
      ? ((tambahPlain + biayaLama) / (tanpa * (profit - discount))) * 100
      : null;
  const selisihVsPlain = tambahBundle - tambahPlain;
  const vonis =
    tambahBundle > 100
      ? "untung"
      : tambahBundle < -100
        ? "rugi"
        : "impas";

  return {
    tanpa,
    takersPlain,
    tambahPlain,
    bundle: {
      valid: true,
      takersBundle,
      tambahBaru,
      biayaLama,
      tambahBundle,
      takersImpas,
      persenImpas,
      setujuBundleMinPct,
      selisihVsPlain,
      vonis,
    },
  };
}

export function pickCashierHints(recs, pendingIds, offerableIds) {
  const pending = pendingIds instanceof Set ? pendingIds : new Set(pendingIds);
  const offerable =
    offerableIds instanceof Set ? offerableIds : new Set(offerableIds);
  const bestByOffer = new Map();
  (recs || []).forEach((rec) => {
    if (
      !pending.has(rec.from) ||
      pending.has(rec.offer) ||
      !offerable.has(rec.offer)
    ) {
      return;
    }
    const current = bestByOffer.get(rec.offer);
    if (
      !current ||
      rec.potensi > current.potensi ||
      (rec.potensi === current.potensi && rec.conf > current.conf)
    ) {
      bestByOffer.set(rec.offer, rec);
    }
  });
  return [...bestByOffer.values()]
    .sort(
      (a, b) =>
        b.potensi - a.potensi ||
        b.conf - a.conf ||
        a.offerName.localeCompare(b.offerName, "id"),
    )
    .slice(0, 2)
    .map(({ from, offer, conf, potensi }) => ({
      from,
      offer,
      conf,
      potensi,
    }));
}
