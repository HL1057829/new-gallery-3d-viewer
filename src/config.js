/** @file Loads and normalizes object configuration from HJSON. */
import HJSON from 'hjson';

/**
 * Fetch and parse the object configuration from the public config folder.
 * @returns {Promise<{
 *   base: Record<string, any>,
 *   bases: Record<string, any>[],
 *   accessories: Record<string, any>[],
 *   markers: Record<string, any>[],
 *   allObjects: Record<string, any>[],
 *   debug: Record<string, any>
 * }>}
 */
export async function loadObjectConfig() {
const response = await fetch(`${import.meta.env.BASE_URL}config/objects.hjson`);
  if (!response.ok) {
    throw new Error(`Failed to load object config: ${response.status} ${response.statusText}`);
  }

  const rawText = await response.text();
  const parsed = HJSON.parse(rawText);

  const objects = parsed?.objects ?? {};
  const defaults = objects.default ?? {};
  const debug = parsed?.debug ?? {};

  const allObjects = Object.entries(objects)
    .filter(([name]) => name !== 'default')
    .map(([name, value]) => {
      const mergedScene = { ...(defaults.scene || {}), ...(value.scene || {}) };
      const mergedInteraction = { ...(defaults.interaction || {}), ...(value.interaction || {}) };

      return {
        name,
        ...defaults,
        ...value,
        scene: mergedScene,
        interaction: mergedInteraction
      };
    });

  const bases = allObjects.filter((entry) => entry?.objClass === 'base');
  const accessories = allObjects.filter((entry) => entry?.objClass === 'accessory');
  const markers = allObjects.filter((entry) => entry?.objClass === 'marker');

  if (bases.length === 0) {
    throw new Error('No base object found in configuration.');
  }

  const base = bases[0];

  return { base, bases, accessories, markers, allObjects, debug };
}
