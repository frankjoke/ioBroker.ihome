/** One config document of the selected iHome instance. */
export function configId(name: string, instance: string): string {
  return `${instance}.config.${name}`;
}
