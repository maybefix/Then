import { invoke } from "@tauri-apps/api/core";
import type { PropertyType, PropertyTypeSettings } from "./propertyModel";

// Property name -> type, shared by every work in a library (FM-21). Stored in the
// library's .then/library.json. Outside a library the types live only in memory.

const PROPERTY_TYPES = new Set<string>(["text", "list", "number", "checkbox", "date", "datetime"]);

function onlyKnownTypes(stored: Record<string, string>): PropertyTypeSettings {
  const settings: Record<string, PropertyType> = {};
  for (const [name, type] of Object.entries(stored)) {
    if (PROPERTY_TYPES.has(type)) settings[name] = type as PropertyType;
  }
  return settings;
}

/** `scopePath`: the open library root or one of its works. */
export async function loadPropertyTypes(scopePath: string): Promise<PropertyTypeSettings> {
  return onlyKnownTypes(await invoke<Record<string, string>>("load_library_property_types", { scopePath }));
}

/** Returns every type now saved for the library. Rejects outside a library. */
export async function savePropertyType(
  scopePath: string,
  name: string,
  type: PropertyType,
): Promise<PropertyTypeSettings> {
  return onlyKnownTypes(
    await invoke<Record<string, string>>("save_library_property_type", { scopePath, name, propertyType: type }),
  );
}
