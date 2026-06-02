import { valveThingModel } from "../models/valveThingModel.js";

function cloneThingDefinition<T>(definition: T): T {
  return JSON.parse(JSON.stringify(definition));
}

export function valveThingDescription(valveId: string): any {
  return {
    ...cloneThingDefinition(valveThingModel),
    title: `valve-${valveId}`,
    description: `Smart thermostat valve ${valveId}`
  };
}
