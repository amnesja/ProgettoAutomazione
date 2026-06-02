export const valveThingModel: any = {
  "@context": [
    "https://www.w3.org/2019/wot/td/v1",
    {
      "thermostat": "http://example.org/wot/thermostat#",
      "om": "http://www.ontology-of-units-of-measure.org/resource/om-2/"
    }
  ],
  "@type": "thermostat:Valve",

  properties: {
    temperature: {
      "@type": "thermostat:hasTemperature",
      type: "number",
      readOnly: true,
      observable: true,
      unit: "om:degreeCelsius"
    },
    heating: {
      "@type": "thermostat:hasHeating",
      type: "boolean",
      readOnly: true,
      observable: true
    },
    setpoint: {
      "@type": "thermostat:hasSetpoint",
      type: "number",
      readOnly: true,
      observable: true,
      unit: "om:degreeCelsius"
    }
  },

  actions: {
    updateStatus: {
      "@type": "thermostat:UpdateStatusAction",
      input: {
        type: "object",
        properties: {
          temperature: { type: "number" },
          heating: { type: "boolean" }
        },
        required: ["temperature", "heating"]
      }
    },
    setHeating: {
      "@type": "thermostat:SetHeatingAction",
      input: { type: "boolean" }
    },
    setTargetTemperature: {
      "@type": "thermostat:SetTargetTemperatureAction",
      input: { type: "number" }
    },
    delete: {
      "@type": "thermostat:DeleteAction"
    }
  }
};
