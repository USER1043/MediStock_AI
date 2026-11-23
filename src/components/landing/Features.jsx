import {
  FaBrain, FaBell, FaBoxes, FaChartBar, FaFileExcel,
  FaShieldAlt, FaUsers, FaSync, FaMicrophoneAlt, FaFileMedical
} from 'react-icons/fa';

const features = [
  {
    icon: FaBrain,
    color: 'from-purple-500 to-indigo-600',
    badge: 'AI',
    title: 'AI Demand Forecasting',
    description: 'An LSTM model (TensorFlow.js) learns from your sales history and auto-generates reorder recommendations with High / Medium / Low priority.',
  },
  {
    icon: FaBell,
    color: 'from-red-500 to-rose-600',
    badge: 'Alerts',
    title: 'Smart Alerts & Notifications',
    description: 'Automatic alerts for low stock, near-expiry (7 days), expired medicines, and overstock — categorised by severity.',
  },
  {
    icon: FaBoxes,
    color: 'from-emerald-500 to-teal-600',
    badge: 'Inventory',
    title: 'FEFO Inventory Control',
    description: 'First-Expiry-First-Out sorting ensures perishable medicines are used in the right order, minimising wastage.',
  },
  {
    icon: FaChartBar,
    color: 'from-blue-500 to-cyan-600',
    badge: 'Reports',
    title: 'Reports & Analytics',
    description: 'Daily, weekly, and monthly Sales, Purchase, Inventory, and Financial reports with full data breakdowns.',
  },
  {
    icon: FaFileExcel,
    color: 'from-green-500 to-lime-600',
    badge: 'Excel',
    title: 'Excel Import & Export',
    description: 'Bulk import inventory via drag-and-drop Excel upload. Export your full stock to a formatted .xlsx file in one click.',
  },
  {
    icon: FaMicrophoneAlt,
    color: 'from-orange-500 to-amber-600',
    badge: 'Voice',
    title: 'Voice & Bilingual Chatbot',
    description: 'Ask inventory questions in English or Tamil, by typing or voice, even by brand name. Answers come from live stock, with rack numbers and in-stock alternatives.',
  },
  {
    icon: FaFileMedical,
    color: 'from-pink-500 to-rose-600',
    badge: 'Billing',
    title: 'Fast POS Billing',
    description: 'POS-style billing with medicine search, auto price fill, tax calculation, and complete bill history.',
  },
  {
    icon: FaShieldAlt,
    color: 'from-slate-600 to-gray-700',
    badge: 'Security',
    title: 'Role-Based Access Control',
    description: 'Owner and Staff roles with separate permissions. Every route and API endpoint is JWT-protected.',
  },
];

const Features = () => (
  <section id="features" className="py-24 bg-gray-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="text-center mb-16">
        <span className="inline-block px-4 py-1.5 bg-primary-100 text-primary-700 rounded-full text-sm font-semibold mb-4">
          Platform Features
        </span>
        <h2 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4">
          Everything Your Pharmacy Needs
        </h2>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto">
          A complete AI-powered toolkit purpose-built for modern pharmacy inventory management.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((f, i) => (
          <div key={i}
            className="bg-white rounded-2xl p-6 border border-gray-100 hover:border-primary-200 hover:shadow-xl transition-all duration-300 group cursor-default">
            {/* Icon */}
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
              <f.icon className="text-white text-xl" />
            </div>
            {/* Badge */}
            <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold mb-2">
              {f.badge}
            </span>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Features;
