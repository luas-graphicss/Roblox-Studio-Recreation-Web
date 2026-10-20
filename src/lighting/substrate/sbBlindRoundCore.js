import { confusionRateLuz as scoreEngineTrials, buildPairPlan as buildEnginePairPlan, IL_F43_VERSION } from "../blindParityCore.js"
import { SB_GATES } from "./sbMaterialContract.js"
import { SB_CERTIFICATION_SCENE_IDS, SB_CERTIFICATION_VERSION } from "./sbCertificationContract.js"
import { evidenceProblems, signatureProblems, nonEmptyText, uniqueRecords, sectionResult } from "./sbCertificationEvidenceCore.js"

const evaluatorKey = (value) => typeof value === "string" ? value.trim().toLowerCase() : ""
const truthOptions = ["engine", "ue"]
const guessOptions = [...truthOptions, "indistinto"]

export function evaluateBlindRound(input) {
    const problems = evidenceProblems(input?.evidence, "human-ballots")
    const evaluators = new Map()
    for (const evaluator of Array.isArray(input?.evaluators) ? input.evaluators : []) {
        const key = evaluatorKey(evaluator?.id)
        if (!key || evaluators.has(key)) { problems.push("Missing or duplicate evaluator identity."); continue }
        evaluators.set(key, evaluator)
        if (evaluator.kind !== "human" || evaluator.consent !== true) problems.push("Evaluator must declare human participation and consent: " + key)
        problems.push(...signatureProblems(evaluator).map((problem) => key + ": " + problem))
        problems.push(...evidenceProblems(evaluator.evidence, "human-attestation").map((problem) => key + ": " + problem))
    }
    if (evaluators.size < SB_GATES.blindRoundMinimumEvaluators || evaluators.size > 32) problems.push("The round requires 3 to 32 distinct named human evaluators.")
    const ballots = Array.isArray(input?.ballots) ? input.ballots : []
    const seen = new Set()
    const trials = []
    if (ballots.length > 768) problems.push("Ballot limit exceeded.")
    for (const ballot of ballots.slice(0, 768)) {
        const evaluator = evaluatorKey(ballot?.evaluator)
        if (!evaluators.has(evaluator) || !SB_CERTIFICATION_SCENE_IDS.includes(ballot?.sceneId) || !truthOptions.includes(ballot?.truth) || !guessOptions.includes(ballot?.guess)) {
            problems.push("Malformed ballot or unknown scene/evaluator.")
            continue
        }
        if (ballot.synthetic === true) problems.push("Synthetic blind responses cannot count as human evidence.")
        const key = evaluator + ":" + ballot.sceneId + ":" + ballot.truth
        if (seen.has(key)) { problems.push("Duplicate ballot: " + key); continue }
        seen.add(key)
        if (!nonEmptyText(ballot.roundId) || !nonEmptyText(ballot.answeredAt) || !Number.isFinite(Date.parse(ballot.answeredAt))) problems.push("Ballot has no round identity or timestamp.")
        trials.push({ sceneId: ballot.sceneId, truth: ballot.truth, guess: ballot.guess, avaliador: evaluator })
    }
    for (const evaluator of evaluators.keys()) for (const scene of SB_CERTIFICATION_SCENE_IDS) for (const truth of truthOptions) {
        if (!seen.has(evaluator + ":" + scene + ":" + truth)) problems.push("Missing ballot: " + evaluator + ":" + scene + ":" + truth)
    }
    const score = scoreEngineTrials(trials)
    const scenesCovered = SB_CERTIFICATION_SCENE_IDS.filter((id) => score.perScene[id]?.total > 0).length
    const metrics = { confusionRate: score.rate, evaluators: evaluators.size, scenesCovered }
    return sectionResult(problems, { scoringVersion: IL_F43_VERSION, metrics, total: score.total, confused: score.confused,
        perScene: score.perScene, passed: problems.length === 0 && score.rate >= SB_GATES.blindRoundMinimumConfusionRate })
}

export function createBlindPairPlan(input) {
    const { byId, problems } = uniqueRecords(input?.stills, "sceneId", SB_CERTIFICATION_SCENE_IDS)
    if (!nonEmptyText(input?.roundId) || !/^[A-Za-z0-9_-]{1,64}$/.test(input.roundId)) problems.push("Invalid round identifier.")
    for (const still of byId.values()) for (const side of ["engine", "unreal"]) problems.push(...evidenceProblems(still[side], "capture"))
    if (problems.length) return { accepted: false, problems }
    const plan = buildEnginePairPlan({ seed: input.seed, sceneIds: SB_CERTIFICATION_SCENE_IDS })
    const seen = new Set()
    const pairs = []
    for (const slide of plan.slides) {
        if (seen.has(slide.sceneId)) continue
        seen.add(slide.sceneId)
        const still = byId.get(slide.sceneId)
        const left = slide.truth === "engine" ? still.engine : still.unreal
        const right = slide.truth === "engine" ? still.unreal : still.engine
        if (left.sha256 === right.sha256) problems.push("Identical reference and engine capture: " + slide.sceneId)
        pairs.push({ trialId: input.roundId + "-" + pairs.length, sceneId: slide.sceneId, leftTruth: slide.truth, left, right })
    }
    if (problems.length) return { accepted: false, problems }
    const publicPlan = { version: SB_CERTIFICATION_VERSION, roundId: input.roundId, synthetic: input.synthetic === true, pairs: pairs.map((pair, index) => ({
        trialId: pair.trialId, sceneId: pair.sceneId, leftImage: "sample-" + (index * 2) + ".png", rightImage: "sample-" + (index * 2 + 1) + ".png",
    })) }
    return { accepted: true, problems: [], publicPlan, privateKey: { version: SB_CERTIFICATION_VERSION, roundId: input.roundId, synthetic: input.synthetic === true, seed: plan.seed, pairs } }
}

export function bindBlindAnswers(response, privateKey) {
    const problems = []
    const expectedPairs = Array.isArray(privateKey?.pairs) ? privateKey.pairs : []
    const validKey = privateKey?.version === SB_CERTIFICATION_VERSION && expectedPairs.length === SB_CERTIFICATION_SCENE_IDS.length &&
        expectedPairs.every((pair) => nonEmptyText(pair?.trialId) && SB_CERTIFICATION_SCENE_IDS.includes(pair?.sceneId) && truthOptions.includes(pair?.leftTruth)) &&
        new Set(expectedPairs.map((pair) => pair.trialId)).size === 12 && new Set(expectedPairs.map((pair) => pair.sceneId)).size === 12
    if (!validKey || response?.version !== SB_CERTIFICATION_VERSION || response?.roundId !== privateKey?.roundId || !nonEmptyText(response?.evaluator)) {
        return { accepted: false, ballots: [], problems: ["Response does not match a valid private round key."] }
    }
    const { byId, problems: answerProblems } = uniqueRecords(response?.answers, "trialId", expectedPairs.map((pair) => pair.trialId))
    problems.push(...answerProblems)
    const ballots = []
    for (const pair of expectedPairs) {
        const answer = byId.get(pair.trialId)
        if (!["left", "right", "indistinguishable"].includes(answer?.guess) || !truthOptions.includes(pair.leftTruth)) { problems.push("Invalid blind answer."); continue }
        if (!nonEmptyText(answer.answeredAt) || !Number.isFinite(Date.parse(answer.answeredAt))) problems.push("Blind answer has no valid timestamp.")
        const rightTruth = pair.leftTruth === "engine" ? "ue" : "engine"
        const leftGuess = answer.guess === "indistinguishable" ? "indistinto" : answer.guess === "left" ? "engine" : "ue"
        const rightGuess = leftGuess === "indistinto" ? "indistinto" : leftGuess === "engine" ? "ue" : "engine"
        for (const [truth, guess] of [[pair.leftTruth, leftGuess], [rightTruth, rightGuess]]) ballots.push({
            evaluator: response.evaluator.trim(), roundId: response.roundId, sceneId: pair.sceneId, truth, guess, answeredAt: answer.answeredAt, synthetic: response.synthetic === true || privateKey.synthetic === true,
        })
    }
    return { accepted: problems.length === 0, problems, ballots: problems.length ? [] : ballots }
}
