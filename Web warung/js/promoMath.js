function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function calculatePromoScenario({
  menu,
  recipeCost = 0,
  promoPrice,
  baselinePortions = null,
  uplift = null,
}) {
  const price = toFiniteNumber(menu?.price);
  const enteredCost = toFiniteNumber(menu?.cost);
  const recipeCostValue = toFiniteNumber(recipeCost);
  const otherCost = toFiniteNumber(menu?.other_cost);
  const materialCost = Math.max(enteredCost, recipeCostValue);
  const totalCost = materialCost + otherCost;
  const normalProfitPerPortion = price - totalCost;
  const promoPriceValue = Number(promoPrice);
  const hasValidPromoPrice =
    Number.isFinite(promoPriceValue) &&
    promoPriceValue > 0 &&
    promoPriceValue < price;
  const promoProfitPerPortion = hasValidPromoPrice
    ? promoPriceValue - totalCost
    : null;
  const hasBaseline =
    baselinePortions !== null &&
    baselinePortions !== "" &&
    Number.isFinite(Number(baselinePortions)) &&
    Number(baselinePortions) > 0;
  const baseline = hasBaseline ? Number(baselinePortions) : null;
  const hasUplift =
    uplift !== null && uplift !== "" && Number.isFinite(Number(uplift));
  const upliftValue = hasUplift ? Number(uplift) : null;

  const result = {
    price,
    enteredCost,
    recipeCost: recipeCostValue,
    materialCost,
    otherCost,
    totalCost,
    normalProfitPerPortion,
    promoPrice: hasValidPromoPrice ? promoPriceValue : null,
    promoProfitPerPortion,
    breakEvenIncrease: null,
    baselinePortions: baseline,
    minimumPortions: null,
    forecastPortions: null,
    normalProfitTotal: null,
    promoProfitTotal: null,
    profitDifference: null,
    verdict: null,
    status: "ready",
  };

  if (normalProfitPerPortion <= 0) {
    result.status = "normal-not-profitable";
    return result;
  }
  if (!hasValidPromoPrice) {
    result.status = "invalid-promo-price";
    return result;
  }
  if (promoProfitPerPortion < 0) {
    result.status = "promo-below-cost";
    return result;
  }
  if (promoProfitPerPortion === 0) {
    result.status = "promo-at-cost";
    return result;
  }

  result.breakEvenIncrease =
    normalProfitPerPortion / promoProfitPerPortion - 1;
  if (baseline !== null) {
    result.minimumPortions = baseline * (1 + result.breakEvenIncrease);
  }

  if (baseline !== null && upliftValue !== null) {
    result.forecastPortions = Math.max(0, baseline * (1 + upliftValue));
    result.normalProfitTotal = baseline * normalProfitPerPortion;
    result.promoProfitTotal =
      result.forecastPortions * promoProfitPerPortion;
    result.profitDifference =
      result.promoProfitTotal - result.normalProfitTotal;
    const threshold = result.normalProfitTotal * 0.02;
    if (result.profitDifference > threshold) {
      result.verdict = "untung";
    } else if (result.profitDifference < -threshold) {
      result.verdict = "rugi";
    } else {
      result.verdict = "impas";
    }
  }

  return result;
}

export function buildPromoComparison({
  menu,
  recipeCost = 0,
  discountPercentages = [5, 10, 15, 20, 25, 30],
  baselinePortions = null,
  uplift = null,
}) {
  const price = toFiniteNumber(menu?.price);
  return discountPercentages.map((discountPercentage) => {
    const promoPrice = price * (1 - discountPercentage / 100);
    return {
      discountPercentage,
      ...calculatePromoScenario({
        menu,
        recipeCost,
        promoPrice,
        baselinePortions,
        uplift,
      }),
    };
  });
}

export function choosePromoUplift(events, menuId, minimumCount = 3) {
  const validEvents = events.filter((event) =>
    Number.isFinite(Number(event.deviationPct)),
  );
  const menuEvents = validEvents.filter((event) => event.menuId === menuId);
  let selectedEvents = [];
  let source = "insufficient";

  if (menuEvents.length >= minimumCount) {
    selectedEvents = menuEvents;
    source = "menu";
  } else if (validEvents.length >= minimumCount) {
    selectedEvents = validEvents;
    source = "all";
  }

  return {
    source,
    events: selectedEvents,
    count: selectedEvents.length,
    totalCount: validEvents.length,
    average: selectedEvents.length
      ? selectedEvents.reduce(
          (sum, event) => sum + Number(event.deviationPct),
          0,
        ) / selectedEvents.length
      : null,
  };
}
