import { Link } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { FaEnvelope, FaGithub, FaLinkedin } from 'react-icons/fa';

const Footer = () => (
  <footer className="bg-gray-950 text-gray-400">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">

        {/* Brand */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl overflow-hidden border border-white/20 shadow-md bg-white/10 flex-shrink-0">
              <img src={logo} alt="MediStock AI" className="h-full w-full object-cover" />
            </div>
            <span className="text-2xl font-bold text-white">
              MediStock <span className="text-primary-400">AI</span>
            </span>
          </div>
          <p className="text-gray-500 leading-relaxed mb-5 max-w-sm">
            An AI-powered pharmacy inventory management system built for modern pharmacies.
            Smart. Fast. Bilingual.
          </p>
          <div className="flex gap-3">
            <a href="mailto:prjnkrthk@gmail.com" className="w-9 h-9 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/20 transition-colors">
              <FaEnvelope className="text-sm" />
            </a>
            <a href="https://github.com/USER1043/MediStock_AI" target="_blank" rel="noreferrer" aria-label="MediStock AI on GitHub" className="w-9 h-9 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/20 transition-colors">
              <FaGithub className="text-sm" />
            </a>
            <a href="https://linkedin.com/in/prajan-karthik" target="_blank" rel="noreferrer" aria-label="Prajan Karthik on LinkedIn" className="w-9 h-9 bg-white/10 border border-white/10 rounded-lg flex items-center justify-center hover:bg-white/20 transition-colors">
              <FaLinkedin className="text-sm" />
            </a>
          </div>
        </div>

        {/* Features */}
        <div>
          <h4 className="text-white font-semibold mb-4">Features</h4>
          <ul className="space-y-2 text-sm">
            {['AI Chatbot', 'FEFO Sorting', 'Demand Forecasting', 'Excel Import/Export', 'Smart Alerts', 'Role-Based Access'].map(f => (
              <li key={f}><span className="hover:text-white transition-colors cursor-default">{f}</span></li>
            ))}
          </ul>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="text-white font-semibold mb-4">Quick Links</h4>
          <ul className="space-y-2 text-sm">
            <li><Link to="/login" className="hover:text-white transition-colors">Login</Link></li>
            <li><button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition-colors">Features</button></li>
            <li><button onClick={() => document.getElementById('ai')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition-colors">AI Chatbot</button></li>
            <li><button onClick={() => document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition-colors">Architecture</button></li>
            <li><button onClick={() => document.getElementById('techstack')?.scrollIntoView({ behavior: 'smooth' })}
              className="hover:text-white transition-colors">Tech Stack</button></li>
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm">
        <p>© {new Date().getFullYear()} MediStock AI. All rights reserved.</p>
        <p className="text-gray-600">Built with ❤️ — Academic Capstone Project</p>
      </div>
    </div>
  </footer>
);

export default Footer;
