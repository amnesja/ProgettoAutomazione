// valveTemplate.ts

export function valveThingModel(valveId: string): any {
  const thingTitle = `valve-${valveId}`;
  
  return {
    // Annotazione Semantica: Colleghiamo lo standard W3C alla ontologia e alle unità di misura
    "@context": [
      "https://www.w3.org/2019/wot/td/v1",
      {
        "thermostat": "http://example.org/wot/thermostat#",
        "om": "http://www.ontology-of-units-of-measure.org/resource/om-2/"
      }
    ],
    // Dichiariamo che questa Thing appartiene alla classe :Valve della ontologia
    "@type": "thermostat:Valve", 
    
    title: thingTitle,
    description: `Smart thermostat valve ${valveId}`,
    
    properties: {
      temperature: { 
        "@type": "thermostat:hasTemperature", // Legame con la DatatypeProperty dell'ontologia
        type: "number", 
        readOnly: true, 
        observable: true,
        unit: "om:degreeCelsius" // Specificato in Gradi Celsius
      },
      heating: { 
        "@type": "thermostat:hasHeating", // Legame con la DatatypeProperty dell'ontologia
        type: "boolean", 
        readOnly: true, 
        observable: true 
      },
      setpoint: { 
        "@type": "thermostat:hasSetpoint", // Legame con la DatatypeProperty dell'ontologia
        type: "number", 
        readOnly: true, 
        observable: true,
        unit: "om:degreeCelsius" // Anche il target è in Gradi Celsius
      }
    },
    
    actions: {
      updateStatus: {
        // LEGAME ONTOLOGICO: Mappato sul concetto di telemetria continua
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
        // LEGAME ONTOLOGICO: Mappato sull'azione di forzatura fisica dello stato termico
        "@type": "thermostat:SetHeatingAction",
        input: { type: "boolean" } 
      },
      setTargetTemperature: { 
        // LEGAME ONTOLOGICO: Mappato sull'azione di cambio setpoint amministrativo
        "@type": "thermostat:SetTargetTemperatureAction",
        input: { type: "number" } 
      },
      delete: {
        // LEGAME ONTOLOGICO: Mappato sull'azione di rimozione e decommissionamento
        "@type": "thermostat:DeleteAction"
      }
    }
  };
}