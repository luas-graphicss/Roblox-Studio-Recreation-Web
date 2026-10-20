import { slabParameterNames, slabParameterSchema } from './sbSlabParameterSchema.js';

const parameterNames = slabParameterNames();

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampToRange(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapIntoPeriod(value, minimum, period) {
  const offset = (value - minimum) % period;
  return minimum + (offset >= 0 ? offset : offset + period);
}

function reduceChannelsToScalar(channels) {
  const finiteChannels = channels.filter(isFiniteNumber);
  if (finiteChannels.length === 0) return null;
  return finiteChannels.reduce((total, channel) => total + channel, 0) / finiteChannels.length;
}

function toScalarCandidate(raw) {
  if (isFiniteNumber(raw)) return raw;
  if (Array.isArray(raw)) return reduceChannelsToScalar(raw);
  return null;
}

function sanitizeScalar(schema, raw) {
  const candidate = toScalarCandidate(raw);
  if (candidate === null) return schema.defaultValue;
  if (schema.integer) return clampToRange(Math.round(candidate), schema.minimum, schema.maximum);
  if (schema.kind === 'angleRadians') return wrapIntoPeriod(candidate, schema.minimum, schema.encoding.rangeWidth);
  return clampToRange(candidate, schema.minimum, schema.maximum);
}

function sanitizeChannels(schema, raw) {
  const fallback = schema.defaultValue;
  if (isFiniteNumber(raw)) {
    const replicated = clampToRange(raw, schema.minimum, schema.maximum);
    return [replicated, replicated, replicated];
  }
  if (!Array.isArray(raw) || raw.length !== 3) return fallback.slice();
  return raw.map((channel, index) => isFiniteNumber(channel) ? clampToRange(channel, schema.minimum, schema.maximum) : fallback[index]);
}

export function sanitizeSlabParameter(name, raw) {
  const schema = slabParameterSchema(name);
  if (schema === null) return null;
  if (schema.encoding.channelCount === 3) return sanitizeChannels(schema, raw);
  return sanitizeScalar(schema, raw);
}

function applySecondLobeCoupling(parameters) {
  if (parameters.secondRoughnessWeight > 0) {
    parameters.secondRoughness = Math.max(parameters.secondRoughness, slabParameterSchema('roughness').minimum);
  }
  return parameters;
}

export function sanitizeSlabParameters(raw) {
  const source = raw === null || typeof raw !== 'object' ? {} : raw;
  const sanitized = {};
  parameterNames.forEach(name => { sanitized[name] = sanitizeSlabParameter(name, source[name]); });
  return applySecondLobeCoupling(sanitized);
}

export function createDefaultSlabParameters() {
  return sanitizeSlabParameters({});
}

function findChannelProblem(schema, value) {
  if (!Array.isArray(value) || value.length !== 3) return `${schema.name}: esperado vetor de 3 canais`;
  const badChannelIndex = value.findIndex(channel => !isFiniteNumber(channel) || channel > schema.maximum || schema.minimum > channel);
  if (badChannelIndex >= 0) return `${schema.name}: canal ${badChannelIndex} fora de [${schema.minimum}, ${schema.maximum}]`;
  return null;
}

function findScalarProblem(schema, value) {
  if (!isFiniteNumber(value)) return `${schema.name}: esperado numero finito`;
  if (schema.integer && !Number.isInteger(value)) return `${schema.name}: expected an integer`;
  if (value > schema.maximum || schema.minimum > value) return `${schema.name}: ${value} fora de [${schema.minimum}, ${schema.maximum}]`;
  return null;
}

export function findSlabParameterProblems(parameters) {
  const source = parameters === null || typeof parameters !== 'object' ? {} : parameters;
  const problems = [];
  parameterNames.forEach(name => {
    const schema = slabParameterSchema(name);
    const value = source[name];
    const problem = schema.encoding.channelCount === 3 ? findChannelProblem(schema, value) : findScalarProblem(schema, value);
    if (problem !== null) problems.push(problem);
  });
  return problems;
}

export function isSlabParametersSanitized(parameters) {
  return findSlabParameterProblems(parameters).length === 0;
}
