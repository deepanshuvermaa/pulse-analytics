import { Link } from 'react-router-dom';
import { BarChart3, Zap, Shield, Globe, Code, Users, ArrowRight, Play, Sparkles, Menu, X } from 'lucide-react';
import { useState } from 'react';
import BoomerangVideoBg from '../components/BoomerangVideoBg';

const VIDEO_URL = '/pulsehero.mp4';

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="font-body">
      {/* HERO */}
      <section className="relative w-full min-h-screen overflow-hidden">
        <BoomerangVideoBg src={VIDEO_URL} className="absolute inset-0 w-full h-full" />
        <div className="absolute inset-0 bg-black/60" />

        {/* Nav */}
        <nav className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 sm:px-6 md:px-10 py-4 sm:py-6">
          <span className="text-lg sm:text-xl font-semibold tracking-tight text-white">
            Pulse<sup className="text-xs font-medium">™</sup>
          </span>
          <div className="hidden lg:flex items-center gap-1 bg-white/10 backdrop-blur-md rounded-full pl-6 pr-1 py-1 border border-white/20">
            <a href="#features" className="text-sm px-3 py-2 font-medium text-white/80 hover:text-white">Features</a>
            <a href="#how" className="text-sm px-3 py-2 font-medium text-white/80 hover:text-white">How it Works</a>
            <a href="#pricing" className="text-sm px-3 py-2 font-medium text-white/80 hover:text-white">Pricing</a>
            <Link to="/signup" className="ml-2 bg-white hover:bg-white/90 text-forest text-sm font-medium px-5 py-2.5 rounded-full transition-colors">
              Get Started
            </Link>
          </div>
          <div className="flex items-center gap-4 text-white">
            <Link to="/login" className="hidden sm:flex items-center gap-2 text-sm font-medium hover:opacity-80">Sign In</Link>
            <Link to="/signup" className="hidden sm:flex items-center gap-2 text-sm font-medium bg-white text-forest px-4 py-2 rounded-full hover:bg-white/90">Sign Up</Link>
            <button onClick={() => setMenuOpen(!menuOpen)} className="lg:hidden w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </nav>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="lg:hidden fixed inset-0 z-20 bg-white/95 backdrop-blur-xl flex flex-col pt-24 px-8 gap-6">
            <a href="#features" onClick={() => setMenuOpen(false)} className="text-2xl font-semibold text-forest py-3 border-b border-meadow-200">Features</a>
            <a href="#how" onClick={() => setMenuOpen(false)} className="text-2xl font-semibold text-forest py-3 border-b border-meadow-200">How it Works</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="text-2xl font-semibold text-forest py-3 border-b border-meadow-200">Pricing</a>
            <Link to="/signup" className="mt-4 bg-forest text-white text-center py-3 rounded-full font-semibold">Get Started</Link>
          </div>
        )}

        {/* Hero content */}
        <div className="relative z-10 flex flex-col items-center text-center pt-28 sm:pt-36 md:pt-40 px-4">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-1.5 mb-6 border border-white/20">
            <Sparkles className="w-4 h-4 text-meadow-300" />
            <span className="text-sm font-medium text-white">Privacy-first analytics for builders</span>
          </div>
          <h1 className="font-display font-normal leading-[0.95] text-white text-[2rem] sm:text-4xl md:text-5xl lg:text-[4.75rem] max-w-5xl" style={{ letterSpacing: '-0.035em' }}>
            Know your users{' '}<span className="text-meadow-300">without compromising{' '}<br className="hidden sm:block" />their privacy</span>
          </h1>
          <p className="mt-6 sm:mt-8 text-white/80 text-sm sm:text-base md:text-lg leading-relaxed max-w-lg">
            Drop one script tag. Get pageviews, visitors, scroll depth, clicks, and real-time data. No cookies. No consent banners. No complexity.
          </p>
          <div className="mt-8 flex items-center gap-4 flex-wrap justify-center">
            <Link to="/signup" className="bg-white hover:bg-white/90 text-forest font-semibold px-7 py-3.5 rounded-full transition-colors shadow-lg">
              Start Free →
            </Link>
            <a href="#how" className="text-white font-medium flex items-center gap-2 hover:opacity-80">
              <Play className="w-4 h-4" /> See how it works
            </a>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="absolute left-4 sm:left-6 md:left-10 bottom-6 sm:bottom-10 z-10 max-w-sm">
          <p className="text-white/85 text-xs leading-relaxed mb-4 max-w-xs">
            Trusted by indie hackers, startups, and developers who ship fast and care about user privacy.
          </p>
          <div className="flex items-center gap-3 text-white/70 text-xs">
            <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">No cookies</span>
            <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">GDPR ready</span>
            <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">&lt;2KB script</span>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 sm:py-32 bg-meadow-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-forest">Everything you need. Nothing you don't.</h2>
            <p className="mt-4 text-forest-muted max-w-2xl mx-auto">One script tag gives you complete visibility into how users interact with your product — without the bloat of traditional analytics.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: 'Real-time Dashboard', desc: 'See live visitors, pageviews, and engagement as it happens. No 24-hour delay.' },
              { icon: Zap, title: 'Auto-tracking', desc: 'Pageviews, scroll depth, time on page, clicks, referrers, UTMs — all automatic. Zero config.' },
              { icon: Shield, title: 'Privacy First', desc: 'No cookies, no fingerprinting PII, no consent banners needed. GDPR compliant by design.' },
              { icon: Globe, title: 'Works Everywhere', desc: 'React, Next.js, Vue, Svelte, WordPress, plain HTML — if it renders HTML, we track it.' },
              { icon: Code, title: 'One Script Tag', desc: 'Add one line of code. That\'s it. Auto-detects SPAs, handles navigation, tracks everything.' },
              { icon: Users, title: 'Multi-project', desc: 'Track all your projects from one dashboard. Each gets its own snippet and isolated data.' },
            ].map((f, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-meadow-200 hover:border-meadow-400 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-meadow-100 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-meadow-700" />
                </div>
                <h3 className="font-semibold text-forest mb-2">{f.title}</h3>
                <p className="text-sm text-forest-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-24 sm:py-32 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-forest mb-4">Three steps. Two minutes.</h2>
          <p className="text-forest-muted mb-16 max-w-xl mx-auto">From zero to full analytics in less time than it takes to make coffee.</p>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Add your project', desc: 'Enter your site URL. We generate a unique tracking ID instantly.' },
              { step: '02', title: 'Drop the script', desc: 'Copy one <script> tag into your site. Works with any framework or static HTML.' },
              { step: '03', title: 'Watch data flow', desc: 'Real-time pageviews, visitors, scroll depth, clicks — all in your dashboard.' },
            ].map((s, i) => (
              <div key={i} className="text-left sm:text-center">
                <div className="text-5xl font-bold text-meadow-200 mb-3">{s.step}</div>
                <h3 className="font-semibold text-forest mb-2">{s.title}</h3>
                <p className="text-sm text-forest-muted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SNIPPET PREVIEW */}
      <section className="py-24 sm:py-32 bg-forest">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">This is all you need</h2>
          <p className="text-white/70 mb-10">One line. Every page. Every click. Every scroll.</p>
          <div className="bg-black/40 backdrop-blur-sm rounded-2xl p-6 text-left border border-white/10">
            <code className="text-meadow-300 text-sm sm:text-base font-mono">
              &lt;script src="https://your-domain.com/t.js" data-id="your_project_id"&gt;&lt;/script&gt;
            </code>
          </div>
          <Link to="/signup" className="inline-flex items-center gap-2 mt-10 bg-meadow-500 hover:bg-meadow-600 text-white font-semibold px-7 py-3.5 rounded-full transition-colors">
            Get Your Snippet <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 sm:py-32 bg-meadow-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-forest mb-4">Simple pricing</h2>
          <p className="text-forest-muted mb-12">Free for indie hackers. Scale when you're ready.</p>
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl p-8 border border-meadow-200 text-left">
              <div className="text-sm font-semibold text-meadow-600 mb-2">Free</div>
              <div className="text-4xl font-bold text-forest">$0</div>
              <p className="text-sm text-forest-muted mt-2 mb-6">Perfect for side projects</p>
              <ul className="space-y-3 text-sm text-forest-muted">
                <li>✓ 3 projects</li><li>✓ 10K events/month</li><li>✓ 7-day retention</li><li>✓ Real-time dashboard</li>
              </ul>
              <Link to="/signup" className="mt-8 block text-center bg-meadow-100 text-meadow-700 font-semibold py-3 rounded-full hover:bg-meadow-200 transition-colors">Start Free</Link>
            </div>
            <div className="bg-forest rounded-2xl p-8 text-left relative overflow-hidden">
              <div className="absolute top-4 right-4 bg-meadow-500 text-white text-xs font-bold px-3 py-1 rounded-full">Popular</div>
              <div className="text-sm font-semibold text-meadow-300 mb-2">Pro</div>
              <div className="text-4xl font-bold text-white">$9<span className="text-lg font-normal text-white/60">/mo</span></div>
              <p className="text-sm text-white/60 mt-2 mb-6">For serious builders</p>
              <ul className="space-y-3 text-sm text-white/80">
                <li>✓ Unlimited projects</li><li>✓ 1M events/month</li><li>✓ 1-year retention</li><li>✓ Custom events API</li>
              </ul>
              <Link to="/signup" className="mt-8 block text-center bg-meadow-500 text-white font-semibold py-3 rounded-full hover:bg-meadow-400 transition-colors">Get Pro</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 bg-white border-t border-meadow-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-semibold text-forest">Pulse<sup className="text-xs">™</sup> Analytics</span>
          <p className="text-sm text-forest-muted">© 2026 Pulse Analytics. Privacy-first, always.</p>
          <div className="flex gap-6 text-sm text-forest-muted">
            <Link to="/login">Sign In</Link>
            <Link to="/signup">Sign Up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
