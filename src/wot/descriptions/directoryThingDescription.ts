import { directoryThingModel } from "../models/directoryThingModel.js";

function cloneThingDefinition<T>(definition: T): T {
  return JSON.parse(JSON.stringify(definition));
}

export const directoryThingDescription: any = {
  ...cloneThingDefinition(directoryThingModel),
  title: "ValveDirectory",
  description: "List and registration gateway for all available valves"
};
