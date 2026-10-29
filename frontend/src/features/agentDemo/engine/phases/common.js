// Small builders shared by the phase scripts.

const jitter = (base) => base + Math.floor(Math.random() * 60);

/** Inbound WhatsApp event. Always simulated: this app has no WhatsApp connection. */
export const trigger = (title, note, payload) => ({
  kind: 'trigger', agent: 'orch', title, note, name: 'POST /webhook/whatsapp', lat: jitter(90), live: false, payload,
});

export const maskPhone = (mobile) => `+91 ${mobile.slice(0, 2)}••••${mobile.slice(-4)}`;
