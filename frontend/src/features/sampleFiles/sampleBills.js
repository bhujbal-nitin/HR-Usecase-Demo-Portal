// The three sample claim sets for the Reimbursement Manual · Live demo: three bills each, with the same categories, amounts and totals as test_data/Reimbursement_Sample_1..3.
// The vendors are fictional. The bills are drawn in the browser (billPdf.js) when downloaded, dated in the month before that day, so they always look recent.

const two = (n) => String(n).padStart(2, '0');

/** The first and last day of the month before `today`, and a helper that gives "dd/mm/yyyy" for a day of that month. */
export function lastMonth(today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const last = new Date(today.getFullYear(), today.getMonth(), 0);
  const day = (n) => `${two(n)}/${two(first.getMonth() + 1)}/${first.getFullYear()}`;
  const thisMonth = (n) => `${two(n)}/${two(today.getMonth() + 1)}/${today.getFullYear()}`;
  return { first: day(1), last: day(last.getDate()), day, thisMonth };
}

/** [description, amount] rows -> { subtotal, tax, total } for a tax rate (0 for none). */
export function totals(items, rate = 0) {
  const subtotal = Math.round(items.reduce((sum, [, amount]) => sum + amount, 0) * 100) / 100;
  const tax = Math.round(subtotal * rate * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

/** Indian digit grouping with two decimals: 7168 -> "7,168.00". */
export function money(amount) {
  const [whole, decimals] = Math.abs(amount).toFixed(2).split('.');
  const head = whole.length > 3 ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return `${head}.${decimals}`;
}

/**
 * The nine sample bills as they are for a given day. A bill is { file, kind, color, vendor, legal, address[], title, fields[[label, value]], items[[description, amount]],
 * gst, gstLabel, payment, dateField, qr }; `kind` is what the reader should classify it as.
 */
export function sampleBills(today = new Date()) {
  const m = lastMonth(today);
  return [
    {
      file: 'Swift_Cabs_Receipt.pdf', kind: 'Travel', color: '#1F2937', vendor: 'Swift Cabs', legal: 'Zenith Mobility Services Pvt. Ltd.',
      address: ['Tower B, Magarpatta City, Hadapsar, Pune 411028', 'GSTIN: 27AACCZ4417M1Z3   |   support@swiftcabs.example'], title: 'RIDE RECEIPT',
      fields: [['Booking ID', 'SC4817203394'], ['Date', m.day(14)], ['Pickup', 'Baner, Pune'], ['Drop', 'Hinjewadi Phase 2, Pune'], ['Cab type', 'Prime Sedan'], ['Driver', 'Ramesh K. (MH 12 QR 2043)']],
      items: [['Base fare', 90], ['Distance charge (14.2 km)', 213], ['Time charge (38 min)', 76]], gst: 0.05, gstLabel: 'GST (5%)', payment: 'Paid by UPI', dateField: 'Date', qr: true,
    },
    {
      file: 'Saffron_Leaf_Restaurant_Bill.pdf', kind: 'Food', color: '#9A3412', vendor: 'Saffron Leaf Restaurant', legal: 'Saffron Leaf Hospitality LLP',
      address: ['Shop 4, Baner Road, Baner, Pune 411045', 'GSTIN: 27AAGFS2290K1Z6   |   FSSAI Lic. No. 11523998000417'], title: 'TAX INVOICE - DINE IN',
      fields: [['Bill no.', 'SL-20931'], ['Date', m.day(16)], ['Table', '12'], ['Guests', '4'], ['Server', 'Anil']],
      items: [['Paneer Butter Masala', 340], ['Dal Tadka', 240], ['Butter Naan x 4', 240], ['Veg Biryani', 290], ['Cold drink x 2', 140]], gst: 0.05, gstLabel: 'GST (5%)', payment: 'Paid by card', dateField: 'Date',
    },
    {
      file: 'Greenline_Fuel_Receipt.pdf', kind: 'Travel', color: '#166534', vendor: 'Greenline Fuel Station', legal: 'Petro Plus Retail (Dealer)',
      address: ['Pune - Mumbai Road, Wakad, Pune 411057', 'Dealer code: 120453   |   GSTIN: 27AAKFG6671H1Z1'], title: 'FUEL RECEIPT',
      fields: [['Receipt no.', 'GF-558210'], ['Date', m.day(18)], ['Vehicle no.', 'MH 12 AB 4821'], ['Fuel', 'Petrol (MS)'], ['Quantity', '15.00 litres'], ['Rate', 'INR 104.50 per litre']],
      items: [['Petrol 15.00 L', 1567.5]], gst: 0, gstLabel: '', payment: 'Paid by card', dateField: 'Date',
    },
    {
      file: 'RailConnect_Train_Ticket.pdf', kind: 'Travel', color: '#0F766E', vendor: 'RailConnect', legal: 'Bharat Rail Booking Services Ltd.',
      address: ['Train 12124   Deccan Express   Pune Jn (PUNE) to Mumbai CSMT (CSMT)', 'Electronic reservation slip   |   GSTIN: 07AABCB7310N1Z4'], title: 'E-TICKET',
      fields: [['PNR', '4521877093'], ['Journey date', m.day(22)], ['Class', 'Chair Car (CC)'], ['Passenger', '1 adult'], ['Boarding', 'Pune Jn'], ['Quota', 'General']],
      items: [['Base fare', 560], ['Superfast charge', 45], ['Reservation charge', 40], ['Convenience fee (incl. GST)', 23.6]], gst: 0, gstLabel: '', payment: 'Paid online', dateField: 'Journey date', qr: true,
    },
    {
      file: 'Lotus_Residency_Hotel_Bill.pdf', kind: 'Stay', color: '#6B21A8', vendor: 'Hotel Lotus Residency', legal: 'Lotus Hospitality Pvt. Ltd.',
      address: ['Andheri East, Mumbai 400069', 'GSTIN: 27AAFCL3308R1Z8   |   Tel: 022 4000 1188'], title: 'TAX INVOICE - ROOM STAY',
      fields: [['Invoice no.', 'HLR-77412'], ['Bill date', m.day(24)], ['Check-in', m.day(22)], ['Check-out', m.day(24)], ['Room', 'Deluxe, 2 nights']],
      items: [['Room tariff 2 nights x 3,200.00', 6400]], gst: 0.12, gstLabel: 'GST (12%)', payment: 'Paid by card at check-out', dateField: 'Bill date',
    },
    {
      file: 'Telenova_Mobile_Bill.pdf', kind: 'Mobile', color: '#B91C1C', vendor: 'Telenova Postpaid', legal: 'Telenova Communications Limited',
      address: ['Customer care: 198 (toll free)   |   GSTIN: 27AABCT1177Q1Z5', 'Mobile number: 98XXXXX305'], title: 'MONTHLY BILL',
      fields: [['Bill no.', 'TP-90223871'], ['Bill date', m.day(28)], ['Bill period', `${m.first} to ${m.last}`], ['Plan', 'Postpaid 749'], ['Due date', m.thisMonth(15)]],
      items: [['Monthly rental', 635]], gst: 0.18, gstLabel: 'GST (18%)', payment: `Auto-debit on ${m.thisMonth(5)}`, dateField: 'Bill date',
    },
    {
      file: 'Sanjeevani_Clinic_Medical_Bill.pdf', kind: 'Medical', color: '#0E7490', vendor: 'Sanjeevani Clinic & Diagnostics', legal: 'Sanjeevani Healthcare Pvt. Ltd.',
      address: ['Karve Road, Kothrud, Pune 411038', 'Reg. no. MH/PN/2145   |   Tel: 020 2543 7788'], title: 'MEDICAL BILL',
      fields: [['Bill no.', 'SC-60318'], ['Date', m.day(11)], ['Doctor', 'Dr. M. Joshi (General Physician)'], ['Patient', 'Self']],
      items: [['Consultation fee', 700], ['Blood tests (CBC and lipid profile)', 1450]], gst: 0, gstLabel: '', payment: 'Paid by cash', dateField: 'Date',
    },
    {
      file: 'SkyJet_Flight_Ticket.pdf', kind: 'Travel', color: '#1E3A8A', vendor: 'SkyJet Airways', legal: 'SkyJet Aviation Limited',
      address: ['Flight SJ 5316   Pune (PNQ) to Bengaluru (BLR)', 'E-ticket and tax invoice   |   GSTIN: 29AABCS8840P1Z2'], title: 'E-TICKET',
      fields: [['Booking ref.', 'K7Q2MX'], ['Travel date', m.day(26)], ['Passenger', '1 adult'], ['Fare type', 'Saver'], ['Baggage', '15 kg check-in']],
      items: [['Base fare', 4150], ['Airline fuel charge and airport taxes', 640], ['Convenience fee', 300], ['GST (5% on base fare)', 207.5]], gst: 0, gstLabel: '', payment: 'Paid by card', dateField: 'Travel date', qr: true,
    },
    {
      file: 'Sharma_Stationers_Bill.pdf', kind: 'Others', color: '#C2410C', vendor: 'Sharma Stationers', legal: 'Sharma Stationers & Office Supplies',
      address: ['Laxmi Road, Pune 411030', 'GSTIN: 27AAHFS4491D1Z6   |   Tel: 020 2445 2201'], title: 'TAX INVOICE',
      fields: [['Invoice no.', 'SS-3347'], ['Date', m.day(8)]],
      items: [['A4 paper ream x 3', 960], ['File folders x 6', 270], ['Marker pens x 5', 300]], gst: 0.12, gstLabel: 'GST (12%)', payment: 'Paid by UPI', dateField: 'Date',
    },
  ];
}
