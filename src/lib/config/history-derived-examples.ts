export interface DerivedFunctionExample {
  id: string;
  name: string;
  code: string;
}

const values = "const values = samples.map((sample) => sample.val);";

/** Statement bodies offered by the derived-history function editor. */
export const DERIVED_FUNCTION_EXAMPLES: DerivedFunctionExample[] = [
  {
    id: "average",
    name: "Average",
    code: `${values}\nreturn values.length ? mean(values) : NOOP;`,
  },
  {
    id: "time-weighted-average",
    name: "Time-weighted average",
    code:
      "const value = timeWeightedMean(samples, from, to, previous);\n" +
      "return Number.isFinite(value) ? value : NOOP;",
  },
  {
    id: "median",
    name: "Median",
    code: `${values}\nreturn values.length ? median(values) : NOOP;`,
  },
  {
    id: "minimum",
    name: "Minimum",
    code: `${values}\nreturn values.length ? min(values) : NOOP;`,
  },
  {
    id: "maximum",
    name: "Maximum",
    code: `${values}\nreturn values.length ? max(values) : NOOP;`,
  },
  {
    id: "sum",
    name: "Sum",
    code: `${values}\nreturn values.length ? sum(values) : NOOP;`,
  },
];

export const DEFAULT_DERIVED_FUNCTION = DERIVED_FUNCTION_EXAMPLES[0].code;
