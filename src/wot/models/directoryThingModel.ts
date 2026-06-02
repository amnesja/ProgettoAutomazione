export const directoryThingModel: any = {
  "@context": [
    "https://www.w3.org/2019/wot/td/v1",
    {
      "thermostat": "http://example.org/wot/thermostat#"
    }
  ],
  "@type": "thermostat:ValveDirectory",

  properties: {
    valves: {
      "@type": "thermostat:managesValve",
      type: "array",
      readOnly: true
    }
  },

  actions: {
    register: {
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
