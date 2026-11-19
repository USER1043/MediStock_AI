import React, { useState } from 'react';
import {
  Store,
  ShieldCheck,
  Database,
  Bot,
  CreditCard,
  LayoutTemplate,
  Server,
  Building2,
  GraduationCap,
  Sparkles,
  DatabaseZap,
  Code2,
  BrainCircuit,
  Fingerprint,
  ExternalLink
} from 'lucide-react';

// --- MODULAR CONFIGURATION (Swap details here) ---
const FACULTY_NAME = "Dr. T. Senthil Kumar";
const FACULTY_LINK = "https://www.amrita.edu/faculty/t-senthilkumar/";
const FACULTY_IMAGE = "https://webfiles.amrita.edu/2014/01/hhLccN6D-Dr-Senthil-Kumar-T_associate-professor_cse_engineering_coimbatore.jpg";
const CLINIC_NAME = "Padmanaba Medicals";
const CLINIC_LINK = "https://share.google/2v5bEfTay9SK1lG3i";
const CLINIC_IMAGE = "https://lh3.googleusercontent.com/proxy/jNdNuojdxLD7TqK-MxFQTDS2w8QNYmLQ1AlYkLK1u3QTLTuyC6QR18ejR6bibkMCx4Ppf9lg1pxuUHZ1tgVoo3I49q41QMEZRCAWsajlRx8FbZMQqS5eVDnmhg5CuZGX-celRt83CiAMZCLPYVcrDJktxbt8cGMBdMydAg=s1360-w1360-h1020";
const FACULTY_TITLE = "Professor, Dept. of Computer Science and Engineering";

// Shows the photo, or the fallback icon in a same-sized tile if the photo is missing or fails to load
const PhotoOrIcon = ({ src, alt, fallback, className = "", fallbackClassName = "bg-white" }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div role="img" aria-label={alt} className={`w-16 h-16 rounded-xl shadow-sm flex items-center justify-center ${fallbackClassName}`}>
        {fallback}
      </div>
    );
  }
  return (
    <img src={src} alt={alt} onError={() => setFailed(true)} className={`w-16 h-16 rounded-xl object-cover shadow-sm ${className}`} />
  );
};

const About = () => {
  const team = [
    {
      name: "Prajan Karthik V",
      link: "https://linkedin.com/in/prajan-karthik",
      image: "/team/prajan.jpg",
      role: "Lead: Data Architecture",
      description: "Engineered the high-performance data engine of the platform, implementing a system that enables precise tracking of medicine batches and expiration dates for patient safety.",
      icon: <Database className="w-8 h-8 text-emerald-600" />,
      features: [
        { icon: <DatabaseZap className="w-4 h-4" />, text: "Real-world Inventory Modeling" },
        { icon: <Server className="w-4 h-4" />, text: "Optimized Data Retrieval" }
      ],
      hoverBorder: "hover:border-emerald-200",
      accentBg: "bg-emerald-50",
      accentText: "text-emerald-700"
    },
    {
      name: "Kanish Kumaran M",
      link: "https://www.linkedin.com/in/kanishkumaranmm/",
      image: "/team/kanish.jpg",
      role: "Lead: User Operations",
      description: "Developed the secure billing interface and built the access control system, ensuring that sensitive pharmacy data is only accessible to authorized clinical staff.",
      icon: <CreditCard className="w-8 h-8 text-slate-700" />,
      features: [
        { icon: <LayoutTemplate className="w-4 h-4" />, text: "Secure Transaction Billing" },
        { icon: <Fingerprint className="w-4 h-4" />, text: "Role-Based Data Security" }
      ],
      hoverBorder: "hover:border-slate-300",
      accentBg: "bg-slate-100",
      accentText: "text-slate-800"
    },
    {
      name: "Dheemant",
      link: "https://www.linkedin.com/in/dheemantumapathy/",
      image: "/team/dheemant.jpg",
      role: "Lead: AI Intelligence",
      description: "Integrated advanced AI assistants and predictive models to help pharmacists forecast future medicine needs and prevent stock-outs before they happen.",
      icon: <Bot className="w-8 h-8 text-teal-600" />,
      features: [
        { icon: <Sparkles className="w-4 h-4" />, text: "Intelligent Inventory Assistant" },
        { icon: <BrainCircuit className="w-4 h-4" />, text: "Automated Demand Forecasting" }
      ],
      hoverBorder: "hover:border-teal-200",
      accentBg: "bg-teal-50",
      accentText: "text-teal-700"
    }
  ];

  return (
    <div className="bg-slate-50 min-h-screen py-24 px-4 sm:px-6 lg:px-8 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      <div className="max-w-7xl mx-auto space-y-24">

        {/* Header & Mission Section */}
        <section className="text-center max-w-4xl mx-auto space-y-8 animate-fade-in-up">
          <div className="inline-flex items-center px-5 py-2 rounded-full bg-white border border-slate-200 text-slate-600 text-sm font-bold tracking-wide shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
            Project Overview
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight">
            About <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-700 to-slate-500">MediStock AI</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 leading-relaxed font-medium">
            MediStock AI is a clinical-grade pharmacy management platform designed to transform reactive inventory tracking into a proactive, data-driven ecosystem.
          </p>
        </section>

        {/* Collaborator & Faculty Section */}
        <section className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Collaborator Card */}
          <div className="bg-white rounded-xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-slate-200 flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 group">
            <div className="p-4 bg-slate-50 rounded-2xl group-hover:bg-slate-100 transition-colors shrink-0">
              <PhotoOrIcon src={CLINIC_IMAGE} alt={CLINIC_NAME} fallback={<Store className="w-8 h-8 text-slate-500" />} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">The Clinical Collaborator</p>
              <a href={CLINIC_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-2xl font-bold text-slate-900 mb-3 hover:text-blue-600 transition-colors group-hover:text-slate-700">
                {CLINIC_NAME}
                <ExternalLink className="w-5 h-5 ml-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all" />
              </a>
              <p className="text-slate-600 leading-relaxed">
                Partnering to provide real-world insights, ensuring our clinical-grade platform meets the rigorous, day-to-day operational demands of modern pharmacies.
              </p>
            </div>
          </div>

          {/* Project Mentorship Card */}
          <div className="bg-white rounded-xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-emerald-100 flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-6 group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150"></div>
            <div className="p-1 bg-emerald-50 rounded-2xl group-hover:bg-emerald-100 transition-colors shrink-0 relative z-10 w-18 h-18">
              <PhotoOrIcon src={FACULTY_IMAGE} alt={FACULTY_NAME} fallback={<GraduationCap className="w-8 h-8 text-emerald-600" />} />
            </div>
            <div className="relative z-10">
              <p className="text-sm font-bold text-emerald-600 uppercase tracking-wider mb-2">Project Mentorship</p>
              <a href={FACULTY_LINK} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-2xl font-bold text-slate-900 mb-3 hover:text-emerald-600 transition-colors group-hover:text-emerald-800">
                {FACULTY_NAME}
                <ExternalLink className="w-5 h-5 ml-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all" />
              </a>
              <p className="text-slate-600 leading-relaxed italic mb-1">{FACULTY_TITLE}</p>
              <p className="text-slate-600 leading-relaxed">
                Providing expert architectural oversight and guidance, ensuring strict adherence to healthcare compliance and industry best practices.
              </p>
            </div>
          </div>
        </section>

        {/* The Engineering Team Section */}
        <section className="space-y-12">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">The Engineering Team</h2>
            <p className="text-lg text-slate-600 font-medium">The architects behind the infrastructure, intelligence, and operations of the MediStock AI platform.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {team.map((member, idx) => (
              <div key={idx} className={`bg-white rounded-xl p-8 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all duration-300 border border-slate-200 flex flex-col h-full group ${member.hoverBorder}`}>
                <div className="flex items-center space-x-5 mb-6">
                  <div className={`transition-transform group-hover:scale-110 duration-300 shrink-0`}>
                    <div className={`p-1 rounded-2xl ${member.accentBg}`}>
                      <PhotoOrIcon src={member.image} alt={member.name} fallback={member.icon} className="bg-white" />
                    </div>
                  </div>
                  <div>
                    <a href={member.link} target="_blank" rel="noopener noreferrer" className="group/link inline-flex items-center text-xl font-bold text-slate-900 hover:text-blue-600 transition-colors group-hover:text-slate-700">
                      {member.name}
                      <ExternalLink className="w-4 h-4 ml-2 opacity-0 -translate-y-1 group-hover/link:opacity-100 group-hover/link:translate-y-0 transition-all" />
                    </a>
                    <p className={`text-sm font-bold tracking-wide uppercase mt-1 ${member.accentText}`}>{member.role}</p>
                  </div>
                </div>

                <p className="text-slate-600 mb-8 flex-grow leading-relaxed text-base">
                  {member.description}
                </p>

                <div className="space-y-3 mt-auto bg-slate-50 p-5 rounded-xl border border-slate-100">
                  {member.features.map((feature, fIdx) => (
                    <div key={fIdx} className="flex items-center space-x-3 text-sm text-slate-700 font-semibold">
                      <div className={`p-1.5 rounded-lg bg-white shadow-sm text-slate-500`}>
                        {feature.icon}
                      </div>
                      <span>{feature.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;