import { useState, useEffect, useRef } from 'react';
import { SCENE_CATEGORIES, SCENES } from './data/studioPresets.js';

export default function App() {
  // ─── Authentication & SSO State ───────────────────────────────────────────
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState(null);

  // Login Gate State
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [otp, setOtp] = useState('');

  // ─── Studio Configuration State (Pipeline v2) ─────────────────────────────
  // Step 1: Reference Photo
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Step 2: Scene Environment
  const [activeCategory, setActiveCategory] = useState(SCENE_CATEGORIES[0].id);
  const [selectedSceneId, setSelectedSceneId] = useState(SCENES[0].id);

  // Step 3: Optional Outfit Instruction
  const [customNotes, setCustomNotes] = useState('');

  // Generation & Polling State
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('Queuing photoshoot...');
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [activeResult, setActiveResult] = useState(null);

  const pollTimerRef = useRef(null);

  // User's private Cloudinary photoshoot vault
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('yanga_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // ─── Auth Lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    checkSession();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const checkSession = async () => {
    setAuthChecking(true);
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        loadUserHistory(data.user._id);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.warn('SSO check error:', err);
      setUser(null);
    } finally {
      setAuthChecking(false);
    }
  };

  const loadUserHistory = async (userId) => {
    try {
      const res = await fetch(`/api/generate/history?userId=${encodeURIComponent(userId)}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        setHistory((prev) => {
          const map = new Map();
          data.history.forEach((item) => map.set(item.imageUrl, item));
          prev.forEach((item) => map.set(item.imageUrl, item));
          const combined = Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
          );
          localStorage.setItem('yanga_history', JSON.stringify(combined));
          return combined;
        });
      }
    } catch (err) {
      console.warn('Could not load user history:', err);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLoginError(data.message || 'Invalid email or password.');
        return;
      }

      if (data.mfaPending) {
        setMfaToken(data.mfaToken);
        setMfaPending(true);
        return;
      }

      if (data.user) {
        setUser(data.user);
        loadUserHistory(data.user._id);
      }
    } catch (err) {
      console.error(err);
      setLoginError('Could not reach authentication service. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleVerifyMfa = async (e) => {
    e.preventDefault();
    if (otp.trim().length !== 6) {
      setLoginError('Please enter the 6-digit code.');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/auth/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: otp.trim() }),
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLoginError(data.message || 'Incorrect verification code.');
        return;
      }

      if (data.user) {
        setUser(data.user);
        setMfaPending(false);
        setOtp('');
        loadUserHistory(data.user._id);
      }
    } catch (err) {
      console.error(err);
      setLoginError('Verification failed. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.warn(err);
    }
    setUser(null);
    setFile(null);
    setPreviewUrl(null);
    setResults([]);
    setActiveResult(null);
  };

  // ─── File Handling ────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      if (selected.size > 10 * 1024 * 1024) {
        setError('Image file is too large. Please select a photo under 10MB.');
        return;
      }
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setError(null);
    }
  };

  // Filter scenes for currently active category tab
  const filteredScenes = SCENES.filter((s) => s.category === activeCategory);
  const selectedScene = SCENES.find((s) => s.id === selectedSceneId) || SCENES[0];

  // ─── Download Helper ──────────────────────────────────────────────────────
  const handleDownload = async (imageUrl, title) => {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const safeName = (title || 'yanga-photoshoot').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.download = `${safeName}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(imageUrl, '_blank');
    }
  };

  // ─── Generation Completion Handler ────────────────────────────────────────
  const handleGenerationSuccess = (resultData) => {
    const newResult = {
      id: resultData.jobId || Date.now().toString(),
      imageUrl: resultData.imageUrl,
      sceneTitle: selectedScene.title,
      prompt: selectedScene.scenePrompt + (customNotes.trim() ? ` (Outfit: ${customNotes.trim()})` : ''),
      width: resultData.width,
      height: resultData.height,
      upscaled: resultData.upscaled,
      seed: resultData.seed,
      createdAt: resultData.createdAt || new Date().toISOString()
    };

    setResults((prev) => [newResult, ...prev]);
    setActiveResult(newResult);

    // Persist to user history
    setHistory((prev) => {
      const next = [newResult, ...prev.filter((x) => x.imageUrl !== newResult.imageUrl)];
      localStorage.setItem('yanga_history', JSON.stringify(next));
      return next;
    });
  };

  // ─── Poll Job Status ──────────────────────────────────────────────────────
  const pollJobStatus = (jobId) => {
    const startTime = Date.now();
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      // 180s client timeout guard
      if (Date.now() - startTime > 190000) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        setError('Photoshoot generation timed out after 3 minutes. Please try again.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/generate/status/${jobId}`, { credentials: 'include' });
        const data = await res.json();

        if (data.status === 'done' && data.result) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          handleGenerationSuccess(data.result);
          setLoading(false);
        } else if (data.status === 'error') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setError(data.error || 'Photoshoot generation failed.');
          setLoading(false);
        } else {
          // Dynamic stage feedback
          if (data.stage === 'editing') {
            setLoadingStage('Replacing background with Nano Banana...');
          } else if (data.stage === 'upscaling') {
            setLoadingStage('Super-resolution 2x upscale with SeedVR2...');
          } else if (data.stage === 'queued') {
            setLoadingStage('Queued in studio processing pipeline...');
          } else {
            setLoadingStage('Synthesizing photoshoot...');
          }
        }
      } catch (pollErr) {
        console.warn('Job status poll notice:', pollErr);
      }
    }, 3000);
  };

  // ─── Submit Photoshoot Request ───────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please upload a clear reference photo first.');
      return;
    }

    setLoading(true);
    setLoadingStage('Queuing photoshoot...');
    setError(null);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('scene', selectedScene.scenePrompt);
    if (customNotes.trim()) {
      formData.append('outfit', customNotes.trim());
    }

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const data = await response.json();

      if (response.status === 401) {
        setUser(null);
        setError('Your session has expired. Please log in again.');
        setLoading(false);
        return;
      }

      if (response.status === 429) {
        setError(data.error || 'Rate limit reached or duplicate request.');
        setLoading(false);
        return;
      }

      if (!response.ok || !data.success) {
        setError(data.error || 'Generation failed. Please try again.');
        setLoading(false);
        return;
      }

      // Legacy fallback response (returns imageUrl directly)
      if (data.imageUrl) {
        handleGenerationSuccess(data);
        setLoading(false);
        return;
      }

      // Pipeline v2 background job response
      if (data.jobId) {
        pollJobStatus(data.jobId);
      } else {
        setError('Unexpected server response: missing job tracking ID.');
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Network connection failed. Make sure the server is reachable.');
      setLoading(false);
    }
  };

  const clearHistory = () => {
    if (confirm('Clear your local photoshoot history?')) {
      setHistory([]);
      localStorage.removeItem('yanga_history');
    }
  };

  // Initial Auth Loading Screen
  if (authChecking) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin mb-4"></div>
        <p className="text-xs text-neutral-400 font-mono tracking-wider uppercase">Authenticating Rokit SSO...</p>
      </div>
    );
  }

  // ─── ACCESS GATE: Unauthenticated View ────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent pointer-events-none"></div>

        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold tracking-wide uppercase mb-3">
              🔒 Member Access Gate
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
              Yanga <span className="text-amber-500">Studio</span>
            </h1>
            <p className="text-xs text-neutral-400 mt-2">
              Protected by Rokit Media SSO (<code className="text-amber-400/80">.rokitonline.com</code>)
            </p>
          </div>

          <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-sm">
            {!mfaPending ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="text-center pb-2">
                  <h2 className="text-lg font-bold text-white">Sign In to Continue</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Use your central Rokit Media account to access AI photoshoot credits.
                  </p>
                </div>

                {loginError && (
                  <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{loginError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    required
                    placeholder="your@rokitonline.com"
                    className="w-full bg-neutral-950 border border-neutral-700 focus:border-amber-500 text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      required
                      placeholder="••••••••••••"
                      className="w-full bg-neutral-950 border border-neutral-700 focus:border-amber-500 text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-colors pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-3 px-4 rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
                >
                  {loginLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                      <span>Verifying Credentials...</span>
                    </>
                  ) : (
                    <span>Unlock Yanga Studio</span>
                  )}
                </button>

                <div className="pt-2 text-center">
                  <a
                    href="https://v3.rokitonline.com/login"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-neutral-500 hover:text-amber-400 transition-colors"
                  >
                    Need an account? Register at rokitonline.com ↗
                  </a>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyMfa} className="space-y-4">
                <div className="text-center pb-2">
                  <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-2 text-xl font-bold">
                    🛡️
                  </div>
                  <h2 className="text-lg font-bold text-white">Enter Security Code</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    A 6-digit verification code was sent to <strong>{loginForm.email}</strong>.
                  </p>
                </div>

                {loginError && (
                  <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{loginError}</span>
                  </div>
                )}

                <div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    autoFocus
                    placeholder="123456"
                    className="w-full bg-neutral-950 border border-neutral-700 focus:border-amber-500 text-center text-white text-2xl font-mono tracking-widest py-3 rounded-xl outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginLoading || otp.length !== 6}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-3 px-4 rounded-xl text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loginLoading ? 'Verifying Code...' : 'Verify & Enter'}
                </button>

                <div className="flex justify-between items-center pt-2 text-xs text-neutral-400">
                  <button
                    type="button"
                    onClick={() => { setMfaPending(false); setOtp(''); }}
                    className="hover:text-white transition-colors"
                  >
                    ← Back to Login
                  </button>
                  <button
                    type="button"
                    onClick={handleLoginSubmit}
                    disabled={loginLoading}
                    className="text-amber-400 hover:underline"
                  >
                    Resend Code
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── AUTHENTICATED STUDIO VIEW ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-8 flex flex-col items-center">
      {/* Top Bar / Member Banner */}
      <div className="w-full max-w-5xl flex items-center justify-between py-2 px-4 mb-6 rounded-xl bg-neutral-900/60 border border-neutral-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="text-neutral-400">Member:</span>
          <span className="text-neutral-200 font-semibold">{user.email || 'Rokit Online User'}</span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">
            SSO Active
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="text-neutral-400 hover:text-red-400 font-medium transition-colors"
        >
          Sign Out
        </button>
      </div>

      {/* Studio Header */}
      <header className="text-center max-w-2xl mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wide uppercase mb-3">
          Optical Realism • Nano Banana + SeedVR2 HD
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">
          Yanga <span className="text-amber-500">Studio</span>
        </h1>
        <p className="text-neutral-400 text-xs md:text-sm">
          Seamless natural background substitution and 2x super-resolution. Keeps your authentic face, hair, and desk items identical to the original photo.
        </p>
      </header>

      {/* Main Studio Workspace */}
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Studio Controls (7 cols) */}
        <form onSubmit={handleSubmit} className="lg:col-span-7 bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 md:p-7 shadow-2xl flex flex-col gap-6">
          
          {/* ─── STEP 1: Reference Photo Dropzone ─────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[11px] font-black">1</span>
                <span>Reference Photo</span>
              </label>
              {file && (
                <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                  Photo Ready ✓
                </span>
              )}
            </div>

            <div className="border-2 border-dashed border-neutral-700 hover:border-amber-500/60 rounded-xl p-3 transition-colors text-center relative bg-neutral-950/40">
              {previewUrl ? (
                <div className="relative group rounded-lg overflow-hidden flex items-center justify-center bg-black/40">
                  <img src={previewUrl} alt="Reference Preview" className="h-48 object-contain rounded-lg" />
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-medium text-amber-400 cursor-pointer rounded-lg transition-opacity">
                    Click to change photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              ) : (
                <label className="cursor-pointer block py-8">
                  <div className="text-amber-500 text-3xl mb-1.5">📸</div>
                  <span className="text-xs font-medium text-neutral-300 block">Upload your portrait or workspace photo</span>
                  <p className="text-[11px] text-neutral-500 mt-1">JPEG, PNG, or WebP up to 10MB • Output dimensions match original</p>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" required />
                </label>
              )}
            </div>
          </div>

          {/* ─── STEP 2: Scene Environment ─────────────────────────────── */}
          <div className="border-t border-neutral-800 pt-5">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[11px] font-black">2</span>
              <span>Scene Environment</span>
            </label>

            {/* Horizontal Scrollable Category Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {SCENE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(c.id);
                    const firstInCat = SCENES.find((s) => s.category === c.id);
                    if (firstInCat) setSelectedSceneId(firstInCat.id);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    activeCategory === c.id
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'bg-neutral-950 text-neutral-400 border border-neutral-800 hover:text-white'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Filtered Scene Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3">
              {filteredScenes.map((s) => {
                const active = selectedSceneId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSceneId(s.id)}
                    className={`text-left p-3 rounded-xl border text-xs transition-all flex flex-col justify-between ${
                      active
                        ? 'border-amber-500 bg-amber-500/10 text-white shadow-sm ring-1 ring-amber-500/30'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    <div>
                      <div className={active ? 'text-amber-400 font-bold' : 'text-neutral-200 font-medium'}>
                        {s.title}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1 line-clamp-2">
                        {s.subtitle}
                      </div>
                    </div>
                    {active && (
                      <span className="text-[10px] text-amber-400 font-bold mt-2">Selected ✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── STEP 3: Outfit & Wardrobe Change (Optional) ──────────── */}
          <div className="border-t border-neutral-800 pt-5">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[11px] font-black">3</span>
              <span>Outfit & Wardrobe Change (Optional)</span>
            </label>
            <p className="text-[11px] text-neutral-500 mb-2">
              Leave blank to keep your exact original outfit, desk, laptop, and surrounding items intact.
            </p>
            <input
              type="text"
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="e.g. emerald velvet dinner jacket, crisp white collar shirt"
              className="w-full bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs p-3 rounded-xl outline-none focus:border-amber-500"
            />
          </div>

          {/* Error Notice */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2">
              <span className="text-red-400 font-bold">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={loading || !file}
            className="w-full bg-amber-500 text-neutral-950 font-bold py-3.5 px-4 rounded-xl hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                <span>{loadingStage}</span>
              </>
            ) : (
              <span>Shoot Photoshoot ({selectedScene.title})</span>
            )}
          </button>
        </form>

        {/* Right Column: Active Viewport & Session Output Gallery (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Active Highlight Viewport */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 shadow-2xl flex flex-col items-center justify-center min-h-[460px]">
            {activeResult ? (
              <div className="w-full flex flex-col items-center">
                <div className="flex items-center justify-between w-full mb-3 flex-wrap gap-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">{activeResult.sceneTitle || 'AI Photoshoot'}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-neutral-500">
                        {new Date(activeResult.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {activeResult.width && activeResult.height && (
                        <span className="text-[10px] font-mono text-neutral-500">
                          {activeResult.width}×{activeResult.height}px
                        </span>
                      )}
                      <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/60">
                        AI-generated image
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(activeResult.imageUrl, activeResult.sceneTitle)}
                    className="text-xs text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-700 transition-colors flex items-center gap-1.5"
                  >
                    <span>Save HD Photo</span>
                    <span>⬇️</span>
                  </button>
                </div>
                <img
                  src={activeResult.imageUrl}
                  alt={activeResult.prompt || 'Generated Photoshoot'}
                  className="w-full max-h-[520px] object-cover rounded-xl shadow-2xl border-2 border-neutral-800"
                />
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <div className="w-16 h-16 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin mb-4"></div>
                <h3 className="text-base font-bold text-white mb-1">Synthesizing Photoshoot</h3>
                <p className="text-xs text-neutral-400 max-w-xs mb-2">
                  {loadingStage}
                </p>
                <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                  Nano Banana + SeedVR2 Pipeline
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center text-neutral-500 py-16">
                <div className="text-5xl mb-3 opacity-30">✨</div>
                <h3 className="text-sm font-semibold text-neutral-400 mb-1">Studio Viewport Empty</h3>
                <p className="text-xs text-neutral-600 max-w-xs">
                  Upload your photo and click "Shoot Photoshoot" to see your photorealistic editorial portrait here.
                </p>
              </div>
            )}
          </div>

          {/* Session Output Stream (Recent Generative Array) */}
          {results.length > 0 && (
            <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                  This Session's Takes ({results.length})
                </span>
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/60">
                  AI-generated image
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {results.map((r, idx) => (
                  <div
                    key={r.id || idx}
                    onClick={() => setActiveResult(r)}
                    className={`cursor-pointer rounded-xl p-2.5 border transition-all flex items-center justify-between gap-3 ${
                      activeResult?.imageUrl === r.imageUrl
                        ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                        : 'border-neutral-800 bg-neutral-950/60 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={r.imageUrl} alt={r.sceneTitle} className="w-16 h-16 object-cover rounded-lg flex-shrink-0 border border-neutral-800" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-neutral-200 truncate">{r.sceneTitle}</div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">
                          {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {r.width && r.height ? ` • ${r.width}×${r.height}` : ''}
                        </div>
                        <div className="text-[9px] text-neutral-400 mt-1 inline-block">
                          AI-generated image
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(r.imageUrl, r.sceneTitle);
                      }}
                      className="text-[11px] text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 rounded-md border border-neutral-700 flex-shrink-0 transition-colors"
                    >
                      Save HD ⬇️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Bottom Section: Cloudinary Saved Vault ───────────────────────── */}
      {history.length > 0 && (
        <section className="w-full max-w-5xl mt-12 bg-neutral-900/60 p-6 md:p-8 rounded-2xl border border-neutral-800/80">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>📁 Your Saved Photoshoots</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Rokit User Vault
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Saved in your dedicated Cloudinary storage (<code className="text-amber-400/80">yanga-generations/{user._id}</code>).
              </p>
            </div>
            <button
              onClick={clearHistory}
              className="text-xs text-neutral-500 hover:text-red-400 transition-colors"
            >
              Clear Local View
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {history.map((item, idx) => (
              <div
                key={item.id || idx}
                onClick={() => setActiveResult(item)}
                className="group relative bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 hover:border-amber-500/60 cursor-pointer transition-all shadow-md"
              >
                <img
                  src={item.imageUrl}
                  alt={item.prompt || 'Generated Photoshoot'}
                  className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end">
                  <p className="text-[11px] text-white font-medium line-clamp-2">
                    {item.sceneTitle || item.prompt || 'AI Photoshoot'}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-neutral-400">AI-generated image</span>
                    <span className="text-[10px] text-amber-400 font-semibold">View</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
