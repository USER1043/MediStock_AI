import { Link } from 'react-router-dom';
import { FaRocket, FaChartLine, FaShieldAlt, FaBrain } from 'react-icons/fa';
import logo from '../../assets/logo.png';

const stats = [
  { value: '95%+', label: 'Forecast Accuracy' },
  { value: '40%', label: 'Wastage Reduction' },
  { value: 'Real-Time', label: 'Stock Monitoring' },
  { value: '2x', label: 'Faster Billing' },
];

const Hero = () => {
  return (
    <section id="home" className="relative min-h-screen flex items-center overflow-hidden">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-900 via-primary-800 to-blue-900" />

      {/* Decorative blobs */}
      <div className="absolute top-20 right-20 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-20 left-10 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl" />
      <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-28 w-full">
        <div className="text-center">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="h-24 w-24 mx-auto rounded-3xl overflow-hidden border-2 border-white/30 shadow-2xl bg-white/10 backdrop-blur-sm">
              <img src={logo} alt="MediStock AI" className="h-full w-full object-cover" />
            </div>
          </div>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-full mb-6 backdrop-blur-sm">
            <FaBrain className="text-primary-300 text-sm" />
            <span className="text-white/90 font-medium text-sm">AI chatbot powered by Google Gemini</span>
          </div>

          {/* Heading */}
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-white mb-6 leading-tight tracking-tight">
            MediStock{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">AI</span>
            <span className="block text-3xl md:text-4xl font-semibold text-white/80 mt-3">
              Smart Pharmacy Inventory Management
            </span>
          </h1>

          {/* Subheading */}
          <p className="text-lg md:text-xl text-white/70 mb-10 max-w-3xl mx-auto leading-relaxed">
            Eliminate stockouts, reduce medicine wastage, and power your pharmacy with
            AI-driven forecasting, real-time alerts, and intelligent billing — all in one platform.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link to="/login"
              className="flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-400 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-xl hover:shadow-primary-500/40 transition-all duration-300 hover:-translate-y-0.5">
              <FaRocket /> Get Started Free
            </Link>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/30 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-300">
              <FaChartLine /> Explore Features
            </button>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-16">
            {['AI Chatbot', 'FEFO Sorting', 'Demand Forecasting', 'Excel Import/Export', 'Role-Based Access', 'Bilingual (EN/TA)'].map(tag => (
              <span key={tag} className="px-4 py-1.5 bg-white/10 border border-white/20 rounded-full text-white/80 text-sm font-medium backdrop-blur-sm">
                {tag}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {stats.map(s => (
              <div key={s.label} className="bg-white/10 border border-white/20 backdrop-blur-sm rounded-xl p-4">
                <div className="text-3xl font-extrabold text-emerald-300 mb-1">{s.value}</div>
                <div className="text-white/70 text-sm font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 border-2 border-white/40 rounded-full flex justify-center pt-2">
          <div className="w-1 h-3 bg-white/60 rounded-full" />
        </div>
      </div>
    </section>
  );
};

export default Hero;
