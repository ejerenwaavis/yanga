import { useState, useEffect, useRef } from 'react';
import { 
  SCENE_CATEGORIES, 
  SCENES, 
  buildV2Prompt, 
  CLOTHING_REGEX 
} from './data/studioPresets.js';

/**
 * REQUIREMENT 5: User Display Name Priority
 * full name -> first name -> email local part. Never hardcode "Rokit Online User".
 */
export function getDisplayName(user) {
  if (!user) return 'Studio Member';
  const fullName = (user.fullName || user.name || '').trim();
  if (fullName) return fullName;
  const firstName = (user.firstName || '').trim();
  if (firstName) {
    const lastName = (user.lastName || '').trim();
    return lastName ? `${firstName} ${lastName}` : firstName;
  }
  const email = (user.email || '').trim();
  if (email && email.includes('@')) return email.split('@')[0];
  return email || 'Studio Member';
}

const DEFAULT_LOCKS = {
  outfit: true,
  pose: true,
  hair: true,
  props: true,
  background: false
};

function getLineageText(item) {
  if (!item) return 'Version 1 (Initial)';
  const version = item.version || 1;
  const parentShort = item.parentId ? `#${item.parentId.slice(-4)}` : null;
  if (version > 1 && parentShort) {
    return `Version ${version}, edited from ${parentShort}`;
  }
  if (version > 1) {
    return `Version ${version}`;
  }
  return 'Version 1 (Initial)';
}

export default function App() {
  // ─── Authentication & SSO State ───────────────────────────────────────────
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('yanga_user_profile');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Login Gate State
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [otp, setOtp] = useState('');

  // ─── Studio Configuration State (Pipeline v2 Composable UI) ───────────────
  // Step 1: Reference Photo
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  // Step 2: Single Source of Truth Instruction Textarea
  // REQUIREMENT 1: On first load nothing is selected, the textarea is empty, placeholder suggests an example
  const [instruction, setInstruction] = useState('');
  const [highlightedSceneId, setHighlightedSceneId] = useState(null);

  // Lock Toggles (Defaults: Outfit ON, Pose ON, Hair ON, Props ON, Background OFF)
  const [locks, setLocks] = useState(DEFAULT_LOCKS);

  const [showPromptPreview, setShowPromptPreview] = useState(false);
  // Category tabs get an "All" option (default: 'all')
  const [activeCategory, setActiveCategory] = useState('all');

  // Generation & Polling State
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('Queuing photoshoot...');
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [activeResult, setActiveResult] = useState(null);

  // ─── Full-Screen Viewer State (REQUIREMENT 3) ─────────────────────────────
  const [viewerItem, setViewerItem] = useState(null);
  const [viewerMode, setViewerMode] = useState('result'); // 'result' | 'original'

  // ─── Edit Sheet State (REQUIREMENT 3) ──────────────────────────────────────
  const [editingItem, setEditingItem] = useState(null);
  const [editBaseChoice, setEditBaseChoice] = useState('result'); // 'result' | 'original'
  const [editInstruction, setEditInstruction] = useState('');
  const [editLocks, setEditLocks] = useState(DEFAULT_LOCKS);

  // ─── Gallery Card Toggle State: Result | Original (REQUIREMENT 2) ──────────
  const [cardViewMap, setCardViewMap] = useState({}); // { [id]: 'result' | 'original' }

  // ─── Multi-Select & Zip Download State (REQUIREMENT 4) ────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [includeOriginalsZip, setIncludeOriginalsZip] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const pollTimerRef = useRef(null);

  // User's private photoshoot vault
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
        sessionStorage.setItem('yanga_user_profile', JSON.stringify(data.user));
        loadUserHistory(data.user._id);
      } else {
        setUser(null);
        sessionStorage.removeItem('yanga_user_profile');
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
          data.history.forEach((item) => map.set(item.jobId || item.id || item.imageUrl, item));
          prev.forEach((item) => map.set(item.jobId || item.id || item.imageUrl, item));
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
        sessionStorage.setItem('yanga_user_profile', JSON.stringify(data.user));
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
        sessionStorage.setItem('yanga_user_profile', JSON.stringify(data.user));
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
    sessionStorage.removeItem('yanga_user_profile');
    setFile(null);
    setPreviewUrl(null);
    setResults([]);
    setActiveResult(null);
    setSelectedIds(new Set());
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

  // ─── Scene & Instruction Handlers (REQUIREMENT 1) ─────────────────────────
  /**
   * REQUIREMENT 1:
   * Tapping a selected scene card again deselects it.
   * If the textarea still equals that card's starter text, clear it too.
   * If the user edited the text, keep their text.
   * Selecting a scene card turns Keep my background OFF automatically.
   */
  const handleSelectScene = (scene) => {
    if (highlightedSceneId === scene.id) {
      setHighlightedSceneId(null);
      if (instruction.trim() === scene.starter.trim()) {
        setInstruction('');
      }
      return;
    }
    setInstruction(scene.starter);
    setHighlightedSceneId(scene.id);
    setLocks((prev) => ({ ...prev, background: false }));
    setError(null);
  };

  // If the user edits the text, remove the card highlight
  const handleInstructionChange = (e) => {
    const text = e.target.value;
    setInstruction(text);
    const match = SCENES.find((s) => s.starter.trim() === text.trim());
    setHighlightedSceneId(match ? match.id : null);
    setError(null);
  };

  /**
   * REQUIREMENT 1:
   * "Clear" button beside textarea.
   * Clears text, deselects scene card and category tab, and resets locks to defaults.
   */
  const handleClearComposer = () => {
    setInstruction('');
    setHighlightedSceneId(null);
    setActiveCategory('all');
    setLocks({ ...DEFAULT_LOCKS });
    setError(null);
  };

  const toggleLock = (lockKey) => {
    setLocks((prev) => ({ ...prev, [lockKey]: !prev[lockKey] }));
  };

  const toggleEditLock = (lockKey) => {
    setEditLocks((prev) => ({ ...prev, [lockKey]: !prev[lockKey] }));
  };

  // Filter scenes for currently active category tab ('all' shows everything)
  const filteredScenes = activeCategory === 'all'
    ? SCENES
    : SCENES.filter((s) => s.category === activeCategory);

  const activeHighlightedScene = SCENES.find((s) => s.id === highlightedSceneId);

  // Exact Canonical Prompt Preview
  const exactFinalPrompt = buildV2Prompt(instruction, locks);

  // Clothing mention check
  const clothingMentioned = locks.outfit && CLOTHING_REGEX.test(instruction);

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

  // ─── Generation Completion Handler (REQUIREMENT 2) ────────────────────────
  const handleGenerationSuccess = (resultData) => {
    const newResult = {
      id: resultData.jobId || Date.now().toString(),
      jobId: resultData.jobId || Date.now().toString(),
      imageUrl: resultData.imageUrl,
      originalUrl: resultData.originalUrl || previewUrl,
      filename: resultData.filename || resultData.localFileName,
      parentId: resultData.parentId || null,
      baseUsed: resultData.baseUsed || 'original',
      version: resultData.version || 1,
      sceneTitle: activeHighlightedScene?.title || 'Custom Photoshoot',
      instruction: resultData.instruction || instruction,
      prompt: resultData.prompt || exactFinalPrompt,
      locks: resultData.locks || locks,
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
      const next = [newResult, ...prev.filter((x) => (x.jobId || x.id) !== newResult.id && x.imageUrl !== newResult.imageUrl)];
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
          if (data.stage === 'editing_background') {
            setLoadingStage('Synthesizing photoshoot with Nano Banana...');
          } else if (data.stage === 'upscaling_2x') {
            setLoadingStage('Super-resolution 2x upscale with SeedVR2...');
          } else if (data.stage === 'queued') {
            setLoadingStage('Queued in studio processing pipeline...');
          } else {
            setLoadingStage('Processing photoshoot...');
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

    const cleanInstruction = instruction.trim();
    if (!cleanInstruction) {
      setError('Describe the scene or change you want.');
      return;
    }

    setLoading(true);
    setLoadingStage('Queuing photoshoot...');
    setError(null);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('instruction', cleanInstruction);
    formData.append('locks', JSON.stringify(locks));
    if (activeHighlightedScene?.id) {
      formData.append('sceneSlug', activeHighlightedScene.id);
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
        sessionStorage.removeItem('yanga_user_profile');
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

      if (data.imageUrl) {
        handleGenerationSuccess(data);
        setLoading(false);
        return;
      }

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

  // ─── Submit Edit Request (REQUIREMENT 3) ──────────────────────────────────
  const handleEditSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!editingItem) return;

    const cleanEditInstruction = editInstruction.trim();
    if (!cleanEditInstruction) {
      alert('Describe the scene or change you want to make.');
      return;
    }

    const parentId = editingItem.jobId || editingItem.id;
    const formData = new FormData();
    formData.append('parentId', parentId);
    formData.append('baseUsed', editBaseChoice);
    formData.append('instruction', cleanEditInstruction);
    formData.append('locks', JSON.stringify(editLocks));
    if (editBaseChoice === 'original' && file) {
      formData.append('image', file);
    }

    // Close edit sheet
    setEditingItem(null);
    setViewerItem(null);
    setLoading(true);
    setLoadingStage('Queuing photoshoot edit...');
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const data = await response.json();

      if (response.status === 401) {
        setUser(null);
        sessionStorage.removeItem('yanga_user_profile');
        setError('Your session has expired. Please log in again.');
        setLoading(false);
        return;
      }

      if (!response.ok || !data.success) {
        setError(data.error || 'Edit generation failed.');
        setLoading(false);
        return;
      }

      if (data.jobId) {
        pollJobStatus(data.jobId);
      } else if (data.imageUrl) {
        handleGenerationSuccess(data);
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Network connection failed during edit submission.');
      setLoading(false);
    }
  };

  // ─── Delete Actions (REQUIREMENT 3) ───────────────────────────────────────
  const handleDeleteSinglePhoto = async (item) => {
    const jobId = item.jobId || item.id;
    if (!confirm('Are you sure you want to delete this photoshoot from the server?')) {
      return;
    }

    try {
      const res = await fetch(`/api/generate/${jobId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete photo.');
        return;
      }

      setResults((prev) => prev.filter((x) => (x.jobId || x.id) !== jobId));
      setHistory((prev) => {
        const next = prev.filter((x) => (x.jobId || x.id) !== jobId && x.imageUrl !== item.imageUrl);
        localStorage.setItem('yanga_history', JSON.stringify(next));
        return next;
      });

      if ((activeResult?.jobId || activeResult?.id) === jobId || activeResult?.imageUrl === item.imageUrl) {
        setActiveResult(null);
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });

      setViewerItem(null);
    } catch (err) {
      console.error(err);
      alert('Error deleting photo.');
    }
  };

  const handleDeleteAllPhotos = async () => {
    if (!confirm('Are you sure you want to delete all your photoshoots and reference photos from the server? This will permanently remove them from disk.')) {
      return;
    }

    try {
      const res = await fetch('/api/generate/my-photos', {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete photos.');
        return;
      }

      setResults([]);
      setHistory([]);
      setActiveResult(null);
      setSelectedIds(new Set());
      localStorage.removeItem('yanga_history');
      alert('All your photoshoot data and originals have been deleted from disk.');
    } catch (err) {
      console.error(err);
      alert('Error purging photos.');
    }
  };

  // ─── Multi-Select & Batch Zip Download (REQUIREMENT 4) ────────────────────
  // Combine session results and history into one unified list without duplicates
  const allPhotosMap = new Map();
  results.forEach((r) => allPhotosMap.set(r.jobId || r.id, r));
  history.forEach((h) => {
    const id = h.jobId || h.id;
    if (!allPhotosMap.has(id)) {
      allPhotosMap.set(id, h);
    }
  });
  const allPhotos = Array.from(allPhotosMap.values());

  const handleSelectAll = () => {
    const next = new Set();
    allPhotos.forEach((item) => {
      const id = item.jobId || item.id;
      if (id) next.add(id);
    });
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleToggleCardView = (id, e) => {
    if (e) e.stopPropagation();
    setCardViewMap((prev) => ({
      ...prev,
      [id]: prev[id] === 'original' ? 'result' : 'original'
    }));
  };

  const handleDownloadZip = async (isAll = false) => {
    const idsToDownload = isAll ? [] : Array.from(selectedIds);
    if (!isAll && idsToDownload.length === 0) {
      alert('Please select at least one photo to download.');
      return;
    }

    setDownloadingZip(true);
    try {
      const res = await fetch('/api/generate/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          all: isAll,
          jobIds: idsToDownload,
          includeOriginals: includeOriginalsZip
        }),
        credentials: 'include'
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to download zip archive.');
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const now = new Date();
      const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
      link.download = `yanga-photos-${yyyymmdd}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      alert('Error building zip file.');
    } finally {
      setDownloadingZip(false);
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
                {loginError && (
                  <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{loginError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-300 mb-1.5">
                    Rokit Account Email
                  </label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    required
                    placeholder="user@example.com"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-300 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      required
                      placeholder="••••••••"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none transition-colors pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-xs text-neutral-500 hover:text-neutral-300"
                    >
                      {showPassword ? '🙈' : '👁️'}
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
      {/* REQUIREMENT 5: Top Bar / Member Banner showing User's Real Name */}
      <div className="w-full max-w-5xl flex items-center justify-between py-2 px-4 mb-6 rounded-xl bg-neutral-900/60 border border-neutral-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="text-neutral-400">Member:</span>
          <span className="text-neutral-200 font-semibold">{getDisplayName(user)}</span>
          {user.email && user.email !== getDisplayName(user) && (
            <span className="text-[11px] text-neutral-400 hidden sm:inline">({user.email})</span>
          )}
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
          Seamless natural background substitution and 2x super-resolution. Keeps your authentic face, skin tone, hair, and pose identical to your original photo.
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
                  <img src={previewUrl} alt="Reference Preview" className="h-44 object-contain rounded-lg" />
                  {/* REQUIREMENT 2: Original label on reference thumbnail */}
                  <span className="absolute top-2 left-2 bg-black/80 text-amber-400 border border-amber-500/40 text-[10px] font-bold px-2 py-0.5 rounded shadow">
                    Original
                  </span>
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-medium text-amber-400 cursor-pointer rounded-lg transition-opacity">
                    Click to change photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              ) : (
                <label className="cursor-pointer block py-7">
                  <div className="text-amber-500 text-3xl mb-1.5">📸</div>
                  <span className="text-xs font-medium text-neutral-300 block">Upload your portrait or workspace photo</span>
                  <p className="text-[11px] text-neutral-500 mt-1">JPEG, PNG, or WebP up to 10MB • Output dimensions match original</p>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" required />
                </label>
              )}
            </div>
          </div>

          {/* ─── STEP 2: Describe Your Photo (Single Source of Truth) ───── */}
          <div className="border-t border-neutral-800 pt-5">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="instructionField" className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[11px] font-black">2</span>
                <span>Describe your photo</span>
              </label>
              <div className="flex items-center gap-2">
                {/* REQUIREMENT 1: Clear button beside textarea */}
                <button
                  type="button"
                  onClick={handleClearComposer}
                  className="text-[11px] text-neutral-400 hover:text-amber-400 border border-neutral-800 hover:border-neutral-700 bg-neutral-950/60 px-2.5 py-0.5 rounded-md transition-colors"
                  title="Clear text, deselect scene card, reset category tab, and restore default locks"
                >
                  Clear
                </button>
                <span className="text-[10px] text-neutral-500 hidden sm:inline">Single source of truth</span>
              </div>
            </div>

            {/* Editable Textarea: Instruction */}
            {/* REQUIREMENT 1: Placeholder suggests an example */}
            <textarea
              id="instructionField"
              value={instruction}
              onChange={handleInstructionChange}
              rows={3}
              placeholder="e.g. Place me on a cobbled London street in Mayfair at golden hour, with warm lit shop windows."
              className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 text-xs p-3.5 rounded-xl outline-none focus:border-amber-500 transition-colors leading-relaxed resize-y"
            />

            {/* Clothing mention check */}
            {clothingMentioned && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-2 mt-2">
                <span className="flex items-center gap-1.5">
                  <span>💡</span>
                  <span>You described an outfit. Turn off Keep my outfit to change it.</span>
                </span>
                <button
                  type="button"
                  onClick={() => setLocks((prev) => ({ ...prev, outfit: false }))}
                  className="text-[11px] font-bold bg-amber-500 text-neutral-950 px-2 py-0.5 rounded hover:bg-amber-400 whitespace-nowrap transition-colors"
                >
                  Turn Off
                </button>
              </div>
            )}

            {/* REQUIREMENT 4: Lock Toggles under the textarea */}
            <div className="mt-4 pt-3 border-t border-neutral-800/80">
              <div className="flex items-center justify-between mb-2.5 flex-wrap gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                  Keep Rules & Locks
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                  🔒 Face is always locked
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* Lock 1: Outfit */}
                <button
                  type="button"
                  onClick={() => toggleLock('outfit')}
                  className={`p-2 rounded-lg text-left border text-xs transition-all flex items-center justify-between ${
                    locks.outfit
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  <span className="text-[11px] font-medium">Keep my outfit</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${locks.outfit ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                    {locks.outfit ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Lock 2: Pose */}
                <button
                  type="button"
                  onClick={() => toggleLock('pose')}
                  className={`p-2 rounded-lg text-left border text-xs transition-all flex items-center justify-between ${
                    locks.pose
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  <span className="text-[11px] font-medium">Keep my pose</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${locks.pose ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                    {locks.pose ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Lock 3: Hair */}
                <button
                  type="button"
                  onClick={() => toggleLock('hair')}
                  className={`p-2 rounded-lg text-left border text-xs transition-all flex items-center justify-between ${
                    locks.hair
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  <span className="text-[11px] font-medium">Keep my hair</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${locks.hair ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                    {locks.hair ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Lock 4: Props and objects */}
                <button
                  type="button"
                  onClick={() => toggleLock('props')}
                  className={`p-2 rounded-lg text-left border text-xs transition-all flex items-center justify-between ${
                    locks.props
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  <span className="text-[11px] font-medium">Keep props/objects</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${locks.props ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                    {locks.props ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* Lock 5: Background */}
                <button
                  type="button"
                  onClick={() => toggleLock('background')}
                  className={`p-2 rounded-lg text-left border text-xs transition-all flex items-center justify-between ${
                    locks.background
                      ? 'border-amber-500/80 bg-amber-500/15 text-amber-300'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  <span className="text-[11px] font-medium">Keep background</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${locks.background ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}`}>
                    {locks.background ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>

            {/* Collapsed Prompt Preview */}
            <div className="mt-3.5">
              <button
                type="button"
                onClick={() => setShowPromptPreview(!showPromptPreview)}
                className="text-[11px] text-neutral-400 hover:text-amber-400 flex items-center gap-1 transition-colors"
              >
                <span>{showPromptPreview ? '▾ Hide' : '▸ Preview'} exact final prompt</span>
              </button>

              {showPromptPreview && (
                <div className="mt-2 p-3 rounded-xl bg-black/80 border border-neutral-800 font-mono text-[11px] text-amber-200/90 leading-relaxed break-words shadow-inner">
                  {exactFinalPrompt}
                </div>
              )}
            </div>
          </div>

          {/* ─── STEP 3: Scene Inspiration (Tap to load starter text) ──── */}
          <div className="border-t border-neutral-800 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[11px] font-black">3</span>
                <span>Scene Inspiration (Tap to fill instruction)</span>
              </label>
              {highlightedSceneId && (
                <span className="text-[10px] text-amber-400 font-semibold">
                  Card selected ✓ (Tap again to deselect)
                </span>
              )}
            </div>

            {/* Category Tabs with "All" Option */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {SCENE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
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
                const isHighlighted = highlightedSceneId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectScene(s)}
                    className={`text-left p-3 rounded-xl border text-xs transition-all flex flex-col justify-between ${
                      isHighlighted
                        ? 'border-amber-500 bg-amber-500/15 text-white shadow-sm ring-1 ring-amber-500/40'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    <div>
                      <div className={isHighlighted ? 'text-amber-400 font-bold' : 'text-neutral-200 font-medium'}>
                        {s.title}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1 line-clamp-2">
                        {s.subtitle}
                      </div>
                    </div>
                    {isHighlighted && (
                      <span className="text-[10px] text-amber-400 font-bold mt-2">Active Starter ✓</span>
                    )}
                  </button>
                );
              })}
            </div>
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
            disabled={loading || !file || !instruction.trim()}
            className="w-full bg-amber-500 text-neutral-950 font-bold py-3.5 px-4 rounded-xl hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                <span>{loadingStage}</span>
              </>
            ) : (
              <span>Shoot Photoshoot</span>
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
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {getLineageText(activeResult)}
                      </span>
                      {activeResult.width && activeResult.height && (
                        <span className="text-[10px] font-mono text-neutral-500">
                          • {activeResult.width}×{activeResult.height}px
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(activeResult);
                        setEditInstruction(activeResult.instruction || '');
                        setEditLocks(activeResult.locks || DEFAULT_LOCKS);
                        setEditBaseChoice('result');
                      }}
                      className="text-xs text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 rounded-lg border border-neutral-700 transition-colors flex items-center gap-1"
                    >
                      <span>✏️ Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(activeResult.imageUrl, activeResult.sceneTitle)}
                      className="text-xs text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 rounded-lg border border-neutral-700 transition-colors flex items-center gap-1"
                    >
                      <span>⬇️</span>
                    </button>
                  </div>
                </div>
                <div 
                  className="relative group cursor-pointer w-full rounded-xl overflow-hidden border-2 border-neutral-800"
                  onClick={() => {
                    setViewerItem(activeResult);
                    setViewerMode('result');
                  }}
                >
                  <img
                    src={activeResult.imageUrl}
                    alt={activeResult.instruction || activeResult.prompt || 'Generated Photoshoot'}
                    className="w-full max-h-[520px] object-cover group-hover:scale-[1.01] transition-transform duration-200"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-xs font-semibold text-white">
                    Tap to expand full screen ↗
                  </div>
                </div>
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
                  Upload your photo, describe your desired photoshoot scene, and click "Shoot Photoshoot" to see your photorealistic editorial portrait here.
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
                {results.map((r) => {
                  const rId = r.jobId || r.id;
                  const isViewingOrig = cardViewMap[rId] === 'original';
                  const displayImg = isViewingOrig ? (r.originalUrl || previewUrl || r.imageUrl) : r.imageUrl;

                  return (
                    <div
                      key={rId}
                      className={`rounded-xl p-2.5 border transition-all flex items-center justify-between gap-3 ${
                        activeResult?.imageUrl === r.imageUrl
                          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                          : 'border-neutral-800 bg-neutral-950/60 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Multi-Select Checkbox */}
                        <input
                          type="checkbox"
                          checked={selectedIds.has(rId)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(rId)) next.delete(rId);
                              else next.add(rId);
                              return next;
                            });
                          }}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-amber-500/50 cursor-pointer flex-shrink-0"
                        />

                        {/* Thumbnail with Result | Original Toggle & Click to View */}
                        <div 
                          className="relative group cursor-pointer w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-neutral-800"
                          onClick={() => {
                            setViewerItem(r);
                            setViewerMode(isViewingOrig ? 'original' : 'result');
                          }}
                        >
                          <img src={displayImg} alt={r.sceneTitle} className="w-full h-full object-cover" />
                          {isViewingOrig && (
                            <span className="absolute top-1 left-1 bg-amber-500 text-neutral-950 text-[8px] font-black uppercase px-1 rounded">
                              Orig
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-neutral-200 truncate">{r.sceneTitle}</div>
                          <div className="text-[10px] text-neutral-400 mt-0.5 truncate max-w-xs font-mono">
                            {getLineageText(r)}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {/* Result | Original Toggle */}
                            <button
                              type="button"
                              onClick={(e) => handleToggleCardView(rId, e)}
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 hover:text-amber-400 border border-neutral-700 transition-colors"
                            >
                              {isViewingOrig ? 'Show Result' : 'Show Original'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingItem(r);
                                setEditInstruction(r.instruction || '');
                                setEditLocks(r.locks || DEFAULT_LOCKS);
                                setEditBaseChoice('result');
                              }}
                              className="text-[9px] font-semibold text-neutral-400 hover:text-white"
                            >
                              Edit ✏️
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDownload(r.imageUrl, r.sceneTitle)}
                          className="text-[11px] text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded-md border border-neutral-700 transition-colors"
                        >
                          ⬇️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSinglePhoto(r)}
                          className="text-[11px] text-neutral-500 hover:text-red-400 px-1 py-1 transition-colors"
                          title="Delete photo"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Bottom Section: Saved Photoshoots & Batch Management ─────────── */}
      <section className="w-full max-w-5xl mt-12 bg-neutral-900/60 p-6 md:p-8 rounded-2xl border border-neutral-800/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📁 Studio Gallery & History</span>
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {allPhotos.length} Photos
              </span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Originals & generations retained for 7 days. Tap any image to inspect, edit, or download.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDeleteAllPhotos}
            className="text-xs text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-950/60 border border-red-800/50 px-3 py-1.5 rounded-lg transition-colors font-medium self-start md:self-auto"
          >
            Delete my photos now 🗑️
          </button>
        </div>

        {/* REQUIREMENT 4: Batch Actions Toolbar */}
        <div className="w-full bg-neutral-950/80 border border-neutral-800 rounded-xl p-3 mb-6 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded-lg border border-neutral-700 font-medium transition-colors"
            >
              Select All ({allPhotos.length})
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              disabled={selectedIds.size === 0}
              className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg border border-neutral-700 transition-colors"
            >
              Clear Selection
            </button>
            <label className="flex items-center gap-1.5 text-neutral-300 cursor-pointer select-none ml-2">
              <input
                type="checkbox"
                checked={includeOriginalsZip}
                onChange={(e) => setIncludeOriginalsZip(e.target.checked)}
                className="rounded border-neutral-700 text-amber-500 focus:ring-amber-500/50"
              />
              <span className="text-[11px]">Include originals in zip</span>
            </label>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              disabled={selectedIds.size === 0 || downloadingZip}
              onClick={() => handleDownloadZip(false)}
              className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow"
            >
              {downloadingZip ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                  <span>Archiving...</span>
                </>
              ) : (
                <>
                  <span>Download Selected ({selectedIds.size})</span>
                  <span>📦</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={allPhotos.length === 0 || downloadingZip}
              onClick={() => handleDownloadZip(true)}
              className="bg-neutral-800 hover:bg-neutral-700 text-amber-400 hover:text-amber-300 border border-neutral-700 font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Download All
            </button>
          </div>
        </div>

        {/* Gallery Cards Grid */}
        {allPhotos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {allPhotos.map((item) => {
              const itemId = item.jobId || item.id;
              const isSelected = selectedIds.has(itemId);
              const isViewingOrig = cardViewMap[itemId] === 'original';
              const displayImg = isViewingOrig ? (item.originalUrl || previewUrl || item.imageUrl) : item.imageUrl;

              return (
                <div
                  key={itemId}
                  className={`group relative bg-neutral-950 rounded-xl overflow-hidden border transition-all shadow-md flex flex-col ${
                    isSelected ? 'border-amber-500 ring-2 ring-amber-500/40' : 'border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  {/* Top Overlay: Checkbox & Result | Original Toggle */}
                  <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(itemId)) next.delete(itemId);
                          else next.add(itemId);
                          return next;
                        });
                      }}
                      className="w-4 h-4 rounded border-neutral-700 bg-neutral-950 text-amber-500 focus:ring-amber-500/50 cursor-pointer shadow"
                    />

                    <button
                      type="button"
                      onClick={(e) => handleToggleCardView(itemId, e)}
                      className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-black/80 text-neutral-300 hover:text-white border border-neutral-700 backdrop-blur-sm transition-colors shadow"
                    >
                      {isViewingOrig ? 'Result ↺' : 'Original ↺'}
                    </button>
                  </div>

                  {/* Thumbnail Image — Tapping opens Full-Screen Viewer (REQUIREMENT 3) */}
                  <div
                    className="relative cursor-pointer overflow-hidden h-44 bg-neutral-900"
                    onClick={() => {
                      setViewerItem(item);
                      setViewerMode(isViewingOrig ? 'original' : 'result');
                    }}
                  >
                    <img
                      src={displayImg}
                      alt={item.sceneTitle || item.instruction || 'Photoshoot'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {isViewingOrig && (
                      <span className="absolute bottom-2 left-2 bg-amber-500 text-neutral-950 text-[9px] font-black uppercase px-1.5 py-0.5 rounded shadow">
                        Original Photo
                      </span>
                    )}
                  </div>

                  {/* Card Footer Info */}
                  <div className="p-2.5 flex flex-col justify-between flex-1 bg-neutral-950">
                    <div>
                      <p className="text-[11px] text-white font-medium line-clamp-1">
                        {item.sceneTitle || item.instruction || 'AI Photoshoot'}
                      </p>
                      <p className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate">
                        {getLineageText(item)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-neutral-900">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingItem(item);
                          setEditInstruction(item.instruction || '');
                          setEditLocks(item.locks || DEFAULT_LOCKS);
                          setEditBaseChoice('result');
                        }}
                        className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold"
                      >
                        ✏️ Edit
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownload(item.imageUrl, item.sceneTitle)}
                          className="text-[11px] text-neutral-400 hover:text-white"
                          title="Download photo"
                        >
                          ⬇️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSinglePhoto(item)}
                          className="text-[11px] text-neutral-500 hover:text-red-400"
                          title="Delete photo"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-neutral-500 text-xs">
            No photoshoot history saved yet.
          </div>
        )}
      </section>

      {/* ─── FULL-SCREEN VIEWER MODAL (REQUIREMENT 3) ─────────────────────── */}
      {viewerItem && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col backdrop-blur-md">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/80">
            <div className="flex flex-col min-w-0 pr-4">
              <h3 className="text-sm font-bold text-white truncate">
                {viewerItem.sceneTitle || 'Photoshoot Preview'}
              </h3>
              <p className="text-[11px] text-amber-400 font-mono mt-0.5">
                {getLineageText(viewerItem)}
              </p>
            </div>

            {/* Result | Original Toggle */}
            <div className="flex items-center bg-neutral-900 border border-neutral-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewerMode('result')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  viewerMode === 'result' ? 'bg-amber-500 text-neutral-950' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Result
              </button>
              <button
                type="button"
                onClick={() => setViewerMode('original')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  viewerMode === 'original' ? 'bg-amber-500 text-neutral-950' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Original
              </button>
            </div>

            <button
              type="button"
              onClick={() => setViewerItem(null)}
              className="text-neutral-400 hover:text-white text-lg p-2 transition-colors ml-2"
            >
              ✕
            </button>
          </div>

          {/* Main Photo View */}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
            <img
              src={viewerMode === 'original' ? (viewerItem.originalUrl || previewUrl || viewerItem.imageUrl) : viewerItem.imageUrl}
              alt="Photoshoot Full Preview"
              className="max-h-full max-w-full object-contain rounded-xl shadow-2xl"
            />
            <span className="absolute bottom-6 left-6 bg-black/80 text-neutral-200 border border-neutral-700 text-xs font-semibold px-2.5 py-1 rounded-lg backdrop-blur-sm">
              {viewerMode === 'original' ? 'Original Reference Photo' : 'Super-Resolution Generated Result'}
            </span>
          </div>

          {/* Viewer Footer: Instruction, Locks & Actions */}
          <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Instruction Used:</span>
              <p className="text-xs text-neutral-300 italic line-clamp-2 mt-0.5">
                "{viewerItem.instruction || viewerItem.prompt}"
              </p>
            </div>

            <div className="flex items-center gap-2 self-end md:self-auto flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setEditingItem(viewerItem);
                  setEditInstruction(viewerItem.instruction || '');
                  setEditLocks(viewerItem.locks || DEFAULT_LOCKS);
                  setEditBaseChoice('result');
                  setViewerItem(null);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1 shadow"
              >
                <span>✏️ Edit</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownload(
                  viewerMode === 'original' ? (viewerItem.originalUrl || previewUrl || viewerItem.imageUrl) : viewerItem.imageUrl,
                  viewerItem.sceneTitle
                )}
                className="bg-neutral-800 hover:bg-neutral-700 text-white font-medium px-3 py-1.5 rounded-lg text-xs border border-neutral-700 transition-colors flex items-center gap-1"
              >
                <span>Download</span>
                <span>⬇️</span>
              </button>

              <button
                type="button"
                onClick={() => handleDeleteSinglePhoto(viewerItem)}
                className="bg-red-950/40 hover:bg-red-950/70 text-red-400 border border-red-800/60 font-medium px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1"
              >
                <span>Delete</span>
                <span>🗑️</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── EDIT SHEET MODAL (REQUIREMENT 3) ─────────────────────────────── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Edit Photoshoot</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Next Version: v{(editingItem.version || 1) + 1}
                  </span>
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Lineage: {getLineageText(editingItem)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-neutral-400 hover:text-white text-lg p-1 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Base Choice */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-300 mb-2">
                Choose Base Photo
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditBaseChoice('result')}
                  className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                    editBaseChoice === 'result'
                      ? 'border-amber-500 bg-amber-500/15 text-white ring-1 ring-amber-500/30'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  <div className="font-semibold text-neutral-200">This result</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Iterate on current scene</div>
                </button>

                <button
                  type="button"
                  onClick={() => setEditBaseChoice('original')}
                  disabled={!editingItem.originalUrl && !file}
                  className={`p-2.5 rounded-xl border text-left text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    editBaseChoice === 'original'
                      ? 'border-amber-500 bg-amber-500/15 text-white ring-1 ring-amber-500/30'
                      : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  <div className="font-semibold text-neutral-200">Original photo</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Highest facial fidelity</div>
                </button>
              </div>

              {/* Requirement 3 Hint */}
              <p className="text-[11px] text-amber-300/90 mt-2 bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg leading-relaxed">
                💡 Original photo keeps your face most accurate. Edit this result is best for small changes.
              </p>
            </div>

            {/* Instruction Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Instruction
                </label>
                <button
                  type="button"
                  onClick={() => setEditInstruction('')}
                  className="text-[11px] text-neutral-400 hover:text-amber-400 border border-neutral-800 px-2 py-0.5 rounded transition-colors"
                >
                  Clear
                </button>
              </div>
              <textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                rows={3}
                placeholder="Describe changes (e.g. Place me on a street at sunset, change shirt to black jacket)..."
                className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 text-xs p-3 rounded-xl outline-none focus:border-amber-500 transition-colors resize-y leading-relaxed"
              />
            </div>

            {/* Lock Toggles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Keep Rules</span>
                <span className="text-[10px] text-emerald-400">🔒 Face always locked</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => toggleEditLock('outfit')}
                  className={`p-2 rounded-lg text-left border text-xs flex items-center justify-between ${
                    editLocks.outfit ? 'border-amber-500/80 bg-amber-500/15 text-amber-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-500'
                  }`}
                >
                  <span className="text-[11px]">Keep outfit</span>
                  <span className="text-[10px] font-bold">{editLocks.outfit ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleEditLock('pose')}
                  className={`p-2 rounded-lg text-left border text-xs flex items-center justify-between ${
                    editLocks.pose ? 'border-amber-500/80 bg-amber-500/15 text-amber-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-500'
                  }`}
                >
                  <span className="text-[11px]">Keep pose</span>
                  <span className="text-[10px] font-bold">{editLocks.pose ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleEditLock('hair')}
                  className={`p-2 rounded-lg text-left border text-xs flex items-center justify-between ${
                    editLocks.hair ? 'border-amber-500/80 bg-amber-500/15 text-amber-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-500'
                  }`}
                >
                  <span className="text-[11px]">Keep hair</span>
                  <span className="text-[10px] font-bold">{editLocks.hair ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleEditLock('props')}
                  className={`p-2 rounded-lg text-left border text-xs flex items-center justify-between ${
                    editLocks.props ? 'border-amber-500/80 bg-amber-500/15 text-amber-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-500'
                  }`}
                >
                  <span className="text-[11px]">Keep props</span>
                  <span className="text-[10px] font-bold">{editLocks.props ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleEditLock('background')}
                  className={`p-2 rounded-lg text-left border text-xs flex items-center justify-between ${
                    editLocks.background ? 'border-amber-500/80 bg-amber-500/15 text-amber-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-500'
                  }`}
                >
                  <span className="text-[11px]">Keep background</span>
                  <span className="text-[10px] font-bold">{editLocks.background ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSubmit}
                disabled={!editInstruction.trim()}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-950 font-bold px-5 py-2.5 rounded-xl text-xs transition-all shadow-lg shadow-amber-500/10 flex items-center gap-1.5"
              >
                <span>Generate Edit</span>
                <span>✨</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
