import { METERING_SAMPLE_SHADER } from "./meteringSampleShader.js";

export const STATISTICS_INITIAL_SHADER = `${METERING_SAMPLE_SHADER}
void main() {
  ivec2 destination = ivec2(gl_FragCoord.xy);
  int field = destination.x % 4;
  ivec2 origin = ivec2(destination.x / 4, destination.y) * 4;
  vec4 statistics = vec4(0.0);
  for (int row = 0; row < 4; row++) {
    for (int column = 0; column < 4; column++) statistics += meteringSample(origin + ivec2(column, row));
  }
  gl_FragColor = vec4(statistics[field], 0.0, 0.0, 1.0);
}
`;

export const STATISTICS_REDUCE_SHADER = `
uniform sampler2D uPreviousLevel;
uniform ivec2 uPreviousSize;
void main() {
  ivec2 destination = ivec2(gl_FragCoord.xy);
  int field = destination.x % 4;
  ivec2 origin = ivec2(destination.x / 4, destination.y) * 4;
  float sum = 0.0;
  for (int row = 0; row < 4; row++) {
    for (int column = 0; column < 4; column++) {
      ivec2 location = ivec2((origin.x + column) * 4 + field, origin.y + row);
      if (all(lessThan(location, uPreviousSize))) sum += texelFetch(uPreviousLevel, location, 0).r;
    }
  }
  gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
}
`;

export const EMPTY_METERING_SHADER = `
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;
