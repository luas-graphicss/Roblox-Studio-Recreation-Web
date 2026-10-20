function heaviestCandidateIndex(weights) {
  let bestIndex = -1;
  let bestWeight = -1;
  for (let index = 0; index !== weights.length; index++) {
    if (weights[index] > bestWeight) {
      bestWeight = weights[index];
      bestIndex = index;
    }
  }
  return bestIndex;
}


export function sanitizeCandidateWeights(candidateWeights) {
  const input = Array.isArray(candidateWeights) ? candidateWeights : [];
  const problems = [];
  const weights = input.map((rawWeight, index) => {
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || 0 > weight) {
      problems.push("candidate " + index + " had an unusable weight and was zeroed");
      return 0;
    }
    return weight;
  });
  const weightSum = weights.reduce((total, weight) => total + weight, 0);
  const positiveCandidateCount = weights.filter((weight) => weight > 0).length;
  return { weights, weightSum, positiveCandidateCount, problems };
}


export function expectedTapProbabilities(candidateWeights) {
  const sanitized = sanitizeCandidateWeights(candidateWeights);
  if (!(sanitized.weightSum > 0)) return sanitized.weights.map(() => 0);
  return sanitized.weights.map((weight) => weight / sanitized.weightSum);
}


export function selectWeightedTap(request) {
  const settings = request || {};
  const sanitized = sanitizeCandidateWeights(settings.candidateWeights);
  const problems = sanitized.problems.slice();

  if (!(sanitized.weightSum > 0)) {
    return {
      chosenIndex: -1,
      chosenWeight: 0,
      chosenProbability: 0,
      weightSum: 0,
      positiveCandidateCount: 0,
      usedStochasticChoice: false,
      problems,
    };
  }

  const randomValue = Number(settings.randomValue);
  const randomValueIsUsable = Number.isFinite(randomValue) && randomValue >= 0 && 1 > randomValue;
  if (!randomValueIsUsable) {


    problems.push("random value outside [0, 1): took the heaviest tap deterministically");
    const heaviestIndex = heaviestCandidateIndex(sanitized.weights);
    return {
      chosenIndex: heaviestIndex,
      chosenWeight: sanitized.weights[heaviestIndex],
      chosenProbability: sanitized.weights[heaviestIndex] / sanitized.weightSum,
      weightSum: sanitized.weightSum,
      positiveCandidateCount: sanitized.positiveCandidateCount,
      usedStochasticChoice: false,
      problems,
    };
  }

  const target = randomValue * sanitized.weightSum;
  let cumulative = 0;
  let chosenIndex = -1;
  for (let index = 0; index !== sanitized.weights.length; index++) {
    cumulative += sanitized.weights[index];
    if (cumulative > target) {
      chosenIndex = index;
      break;
    }
  }
  if (chosenIndex === -1) {


    chosenIndex = heaviestCandidateIndex(sanitized.weights);
    problems.push("cumulative walk ended on rounding: took the heaviest tap");
  }

  return {
    chosenIndex,
    chosenWeight: sanitized.weights[chosenIndex],
    chosenProbability: sanitized.weights[chosenIndex] / sanitized.weightSum,
    weightSum: sanitized.weightSum,
    positiveCandidateCount: sanitized.positiveCandidateCount,
    usedStochasticChoice: true,
    problems,
  };
}
