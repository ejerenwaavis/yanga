import { useState, useEffect } from 'react';

export default function App() {
  const [userId] = useState(() => {
    let id = localStorage.getItem('yanga_user_id');
    if (!id) {
      id = 'usr_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('yanga_user_id', id);
    }
    return id;
  });

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [preset, setPreset] = useState('owambe');
  const [prompt, setPrompt] = useState('Owambe Glam, Nigerian traditional luxury attire, gele / fila, highly detailed, photorealistic studio lighting, elegant, 8k resolution');
  const [customPrompt, setCustomPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resultImage, setResultImage] = useState(null);

  // User's private photoshoot gallery (persisted locally & synced with Cloudinary)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('yanga_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Fetch Cloudinary generation history on mount
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/generate/history?userId=${encodeURIComponent(userId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.history) && data.history.length > 0) {
          setHistory((prev) => {
            const combinedMap = new Map();
            data.history.forEach((item) => combinedMap.set(item.imageUrl, item));
            prev.forEach((item) => combinedMap.set(item.imageUrl, item));
            const combined = Array.from(combinedMap.values()).sort(
              (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
            );
            localStorage.setItem('yanga_history', JSON.stringify(combined));
            return combined;
          });
        }
      })
      .catch((err) => console.warn('Could not sync remote history:', err));
  }, [userId]);

  const presets = [
    {
      id: 'owambe',
      label: 'Owambe Glam',
      desc: 'Nigerian luxury party attire with studio lighting',
      prompt: 'Owambe Glam, Nigerian traditional luxury attire, gele / fila, highly detailed, photorealistic studio lighting, elegant, 8k resolution'
    },
    {
      id: 'classic',
      label: 'Classic Studio Portrait',
      desc: 'Neutral backdrop with professional editorial lighting',
      prompt: 'Classic Studio portrait, neutral gray backdrop, professional rim lighting, 8k resolution, sharp focus, magazine cover quality'
    },
    {
      id: 'beach',
      label: 'Golden Hour Beach',
      desc: 'Warm sunset lighting in a relaxed coastal setting',
      prompt: 'Golden hour sunset on a tropical beach, warm rim light, natural breeze, cinematic depth of field, photorealistic, 8k resolution'
    },
    {
      id: 'executive',
      label: 'Corporate Executive',
      desc: 'Modern high-rise office boardroom aesthetic',
      prompt: 'Corporate business executive portrait, tailored dark blazer, soft modern high-rise office bokeh background, crisp lighting, confident expression'
    }
  ];

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setError(null);
    }
  };

  const handlePresetSelect = (p) => {
    setPreset(p.id);
    setPrompt(p.prompt);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a photo first.');
      return;
    }

    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('image', file);
    formData.append('prompt', prompt);
    formData.append('userId', userId);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      if (data.success && data.imageUrl) {
        setResultImage(data.imageUrl);

        const newEntry = {
          id: data.publicId || Date.now().toString(),
          imageUrl: data.imageUrl,
          referenceUrl: data.referenceUrl,
          prompt: prompt,
          createdAt: data.createdAt || new Date().toISOString()
        };

        setHistory((prev) => {
          const next = [newEntry, ...prev.filter((x) => x.imageUrl !== newEntry.imageUrl)];
          localStorage.setItem('yanga_history', JSON.stringify(next));
          return next;
        });
      } else {
        setError(data.error || 'Generation failed. Check your FAL_KEY and try again.');
      }
    } catch (err) {
      console.error(err);
      setError('Network connection failed. Make sure the server is reachable.');
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    if (confirm('Clear your local photoshoot history?')) {
      setHistory([]);
      localStorage.removeItem('yanga_history');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-10 flex flex-col items-center">
      {/* Header */}
      <header className="text-center max-w-2xl mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wide uppercase mb-3">
          AI Photoshoot Studio
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2">
          Yanga <span className="text-amber-500">Studio</span>
        </h1>
        <p className="text-neutral-400 text-sm md:text-base">
          Transform your portrait into professional, high-fashion, and themed photoshoot settings using FLUX + PuLID.
        </p>
      </header>

      {/* Main Container */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        {/* Form Column */}
        <form onSubmit={handleSubmit} className="bg-neutral-900 p-6 md:p-8 rounded-2xl border border-neutral-800 shadow-xl flex flex-col gap-6">
          {/* Upload Box */}
          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">
              1. Upload Your Selfie / Portrait
            </label>
            <div className="border-2 border-dashed border-neutral-700 hover:border-amber-500/60 rounded-xl p-4 transition-colors text-center relative bg-neutral-950/40">
              {previewUrl ? (
                <div className="relative group">
                  <img src={previewUrl} alt="Preview" className="w-full h-48 object-cover rounded-lg shadow-md" />
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs font-medium text-amber-400 cursor-pointer rounded-lg transition-opacity">
                    Click to change photo
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  </label>
                </div>
              ) : (
                <label className="cursor-pointer block py-8">
                  <div className="text-amber-500 text-3xl mb-2">📸</div>
                  <span className="text-sm font-medium text-neutral-300">Choose a clear photo of your face</span>
                  <p className="text-xs text-neutral-500 mt-1">PNG, JPG, or WEBP (good lighting works best)</p>
                  <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" required />
                </label>
              )}
            </div>
          </div>

          {/* Preset Styles */}
          <div>
            <label className="block text-sm font-semibold text-neutral-300 mb-2">
              2. Select Photoshoot Theme
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {presets.map((p) => {
                const active = preset === p.id && !customPrompt;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setCustomPrompt(false);
                      handlePresetSelect(p);
                    }}
                    className={`text-left p-3 rounded-xl border text-xs transition-all ${
                      active
                        ? 'border-amber-500 bg-amber-500/10 text-white font-medium shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    <div className={active ? 'text-amber-400 font-bold' : 'text-neutral-200 font-medium'}>
                      {p.label}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">{p.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Custom Prompt Toggle */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setCustomPrompt(!customPrompt)}
                className="text-xs text-amber-400 hover:underline flex items-center gap-1 font-medium"
              >
                {customPrompt ? '← Choose preset styles' : '✍️ Or write a custom prompt'}
              </button>
              {customPrompt && (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="mt-2 w-full bg-neutral-950 text-neutral-200 text-xs p-3 rounded-xl border border-neutral-700 focus:border-amber-500 outline-none"
                  placeholder="Describe outfit, lighting, background..."
                />
              )}
            </div>
          </div>

          {/* Error Notice */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-start gap-2">
              <span className="text-red-400 font-bold">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || !file}
            className="w-full bg-amber-500 text-neutral-950 font-bold py-3.5 px-4 rounded-xl hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-neutral-950" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Generating with FLUX + PuLID...</span>
              </>
            ) : (
              <span>Generate Photoshoot</span>
            )}
          </button>
        </form>

        {/* Results Column */}
        <div className="bg-neutral-900 p-6 md:p-8 rounded-2xl border border-neutral-800 shadow-xl flex flex-col items-center justify-center min-h-[460px]">
          {resultImage ? (
            <div className="w-full flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-3">
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">AI Photoshoot Result</span>
                <a
                  href={resultImage}
                  target="_blank"
                  rel="noreferrer"
                  download="yanga-photoshoot.jpg"
                  className="text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-700 transition-colors"
                >
                  Download HD ⬇️
                </a>
              </div>
              <img
                src={resultImage}
                alt="AI Photoshoot Result"
                className="w-full max-h-[500px] object-cover rounded-xl shadow-2xl border-2 border-neutral-800"
              />
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="w-16 h-16 rounded-full border-4 border-amber-500/20 border-t-amber-500 animate-spin mb-4"></div>
              <h3 className="text-lg font-bold text-white mb-1">Creating Your Transformation</h3>
              <p className="text-xs text-neutral-400 max-w-xs">
                FLUX + PuLID is analyzing facial landmarks and rendering the new environment (~15-30s).
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-neutral-500 py-16">
              <div className="text-5xl mb-3 opacity-40">✨</div>
              <h3 className="text-sm font-semibold text-neutral-400 mb-1">No Photoshoot Yet</h3>
              <p className="text-xs text-neutral-600 max-w-xs">
                Upload your portrait and hit "Generate Photoshoot" to see the transformed photo here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* User's Private Photoshoot History */}
      {history.length > 0 && (
        <section className="w-full max-w-4xl mt-12 bg-neutral-900/60 p-6 md:p-8 rounded-2xl border border-neutral-800/80">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>📁 Your Saved Photoshoots</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Private to you
                </span>
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Saved in your dedicated Cloudinary storage (<code className="text-amber-400/80">yanga-generations</code>).
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
                onClick={() => setResultImage(item.imageUrl)}
                className="group relative bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 hover:border-amber-500/60 cursor-pointer transition-all shadow-md"
              >
                <img
                  src={item.imageUrl}
                  alt={item.prompt || 'Generated Photoshoot'}
                  className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end">
                  <p className="text-[11px] text-white font-medium line-clamp-2">
                    {item.prompt || 'AI Photoshoot'}
                  </p>
                  <span className="text-[10px] text-amber-400 mt-1">Click to view HD</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
