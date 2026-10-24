/** civitai.red Browse keeps models the API marks mature. Safe models stay out. */
export function civitaiRedKeepsModel(nsfw: boolean): boolean {
  return nsfw === true;
}
