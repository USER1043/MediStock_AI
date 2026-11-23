import { FaReact, FaNodeJs, FaDatabase, FaShieldAlt } from 'react-icons/fa';
import { SiVite, SiMongodb, SiExpress, SiTailwindcss, SiGooglegemini } from 'react-icons/si';

const layers = [
  {
    label: 'Frontend',
    color: 'from-cyan-500 to-blue-600',
    icon: FaReact,
    items: [
      { name: 'React 18', icon: FaReact, desc: 'Component-based UI' },
      { name: 'Vite', icon: SiVite, desc: 'Lightning fast builds' },
      { name: 'TailwindCSS', icon: SiTailwindcss, desc: 'Utility-first styling' },
    ],
  },
  {
    label: 'Backend',
    color: 'from-green-500 to-emerald-600',
    icon: FaNodeJs,
    items: [
      { name: 'Node.js', icon: FaNodeJs, desc: 'ES Module server' },
      { name: 'Express', icon: SiExpress, desc: 'REST API layer' },
      { name: 'JWT Auth', icon: FaShieldAlt, desc: 'Secure token auth' },
    ],
  },
  {
    label: 'Database',
    color: 'from-green-600 to-teal-700',
    icon: SiMongodb,
    items: [
      { name: 'MongoDB Atlas', icon: SiMongodb, desc: 'Cloud NoSQL database' },
      { name: 'Mongoose ODM', icon: FaDatabase, desc: 'Schema & validation' },
    ],
  },
  {
    label: 'AI Layer',
    color: 'from-purple-500 to-indigo-600',
    icon: SiGooglegemini,
    items: [
      { name: 'Gemini 3.5 Flash-Lite', icon: SiGooglegemini, desc: 'Live inventory context' },
    ],
  },
];

const Architecture = () => (
  <section id="architecture" className="py-24 bg-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <span className="inline-block px-4 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-semibold mb-4">
          Architecture
        </span>
        <h2 className="text-4xl md:text-5xl font-extrabold text-gray-900 mb-4">
          Modern Full-Stack Architecture
        </h2>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto">
          Clean separation of concerns with a secure backend proxy keeping your API keys safe.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {layers.map((layer, i) => (
          <div key={i} className="rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg transition-all">
            <div className={`bg-gradient-to-br ${layer.color} px-5 py-4 flex items-center gap-3`}>
              <layer.icon className="text-white text-2xl" />
              <span className="text-white font-bold text-lg">{layer.label}</span>
            </div>
            <div className="p-4 bg-gray-50 space-y-3">
              {layer.items.map((item, j) => (
                <div key={j} className="flex items-center gap-3 bg-white p-3 rounded-xl border border-gray-100">
                  <item.icon className="text-gray-500 text-lg flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Flow diagram */}
      <div className="bg-gray-900 rounded-2xl p-8 text-center">
        <p className="text-gray-400 text-sm mb-6 font-medium uppercase tracking-widest">Request Flow</p>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-mono">
          {['Browser (React)', '→', 'Vite Dev / Vercel', '→', 'Express API', '→', 'MongoDB Atlas', '↕', 'Gemini AI (server-side)'].map((item, i) => (
            <span key={i} className={item === '→' || item === '↕'
              ? 'text-gray-500 text-xl'
              : 'bg-white/10 border border-white/20 text-white rounded-lg px-4 py-2'}>
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  </section>
);

export default Architecture;
