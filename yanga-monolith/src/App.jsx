import { useState } from 'react';

export default function App() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState('Owambe Glam, Nigerian traditional attire, highly detailed, photorealistic studio lighting');
  const [loading, setLoading] = useState(false);
  const [resultImage, setResultImage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('image', file);
    formData.append('prompt', prompt);

    try {
      // The Vite proxy handles routing this to localhost:3000 during dev
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      if (data.success) {
        setResultImage(data.imageUrl);
      } else {
        alert('Generation failed: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Network error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-6 flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold text-amber-500 mb-2">Yanga Architecture Test</h1>
      <p className="text-gray-400 mb-8">FLUX + PuLID Test Environment</p>
      
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-neutral-800 p-6 rounded-xl shadow-lg border border-neutral-700">
        <div className="mb-4">
          <label className="block mb-2 text-sm font-medium text-gray-300">Upload Reference Selfie</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={(e) => setFile(e.target.files[0])}
            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-amber-500 file:text-neutral-900 hover:file:bg-amber-400 cursor-pointer"
            required
          />
        </div>
        
        <div className="mb-6">
          <label className="block mb-2 text-sm font-medium text-gray-300">Template Style</label>
          <select 
            value={prompt} 
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full bg-neutral-700 text-white rounded-lg p-3 outline-none focus:ring-2 focus:ring-amber-500 border border-neutral-600"
          >
            <option value="Owambe Glam, Nigerian traditional attire, highly detailed, photorealistic studio lighting, 8k resolution">Owambe Glam</option>
            <option value="Beach Day, sunset lighting, casual wear, photorealistic, cinematic, bright lighting">Beach Day</option>
            <option value="Classic Studio portrait, neutral background, professional lighting, 8k resolution, sharp focus">Classic Studio</option>
          </select>
        </div>

        <button 
          type="submit" 
          disabled={loading || !file}
          className="w-full bg-amber-500 text-neutral-900 font-bold py-3 rounded-lg hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Processing FLUX+PuLID...' : 'Generate Image'}
        </button>
      </form>

      {resultImage && (
        <div className="mt-10 text-center animate-fade-in">
          <h2 className="text-xl font-semibold mb-4 text-amber-500">Generation Complete</h2>
          <img src={resultImage} alt="Generated" className="max-w-md w-full rounded-xl shadow-2xl border-4 border-neutral-800" />
          <a href={resultImage} download="yanga-test.jpg" className="inline-block mt-4 text-sm text-gray-400 hover:text-white underline">
            Download Image
          </a>
        </div>
      )}
    </div>
  );
}
