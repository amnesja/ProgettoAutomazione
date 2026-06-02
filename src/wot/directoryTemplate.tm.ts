// directoryTemplate.ts

export const directoryThingModel: any = {
  // Annotazione Semantica anche per la Directory
  "@context": [
    "https://www.w3.org/2019/wot/td/v1",
    {
      "thermostat": "http://example.org/wot/thermostat#"
    }
  ],
  
  // LEGAME ONTOLOGICO: Questa Thing è un'istanza della classe ValveDirectory
  "@type": "thermostat:ValveDirectory",
  
  title: "ValveDirectory",
  description: "List and registration gateway for all available valves",
  
  properties: {
    valves: { 
      // LEGAME ONTOLOGICO: Rappresenta la relazione che connette la directory alle valvole gestite
      "@type": "thermostat:managesValve",
      type: "array", 
      readOnly: true 
    }
  },
  
  actions: {
    register: {
      // LEGAME ONTOLOGICO: Questa azione corrisponde all'individuo RegisterAction
      "@type": "thermostat:RegisterAction",
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      },
      output: {
        type: "object",
        properties: { setpoint: { type: "number" } }
      }
    }
  }
};