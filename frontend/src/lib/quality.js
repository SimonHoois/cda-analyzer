export function firstProblem(quality) {
  return quality?.checks.find((c) => !c.pass && !c.warning) || null
}
