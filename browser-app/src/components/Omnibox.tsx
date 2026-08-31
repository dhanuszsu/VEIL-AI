import React, { useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, ShieldCheck, Lock } from "lucide-react";

interface OmniboxProps {
  currentUrl: string;
  onNavigate: (url: string) => void;
  onReload: () => void;
  sensitiveCount: number;
}

export const Omnibox: React.FC<OmniboxProps> = ({
  currentUrl,
  onNavigate,
  onReload,
  sensitiveCount,
}) => {
  const [inputUrl, setInputUrl] = useState(currentUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    onNavigate(url);
  };

  return (
    <div className="browser-header">
      <div className="browser-header__logo">
        <ShieldCheck className="browser-header__logo-icon" size={20} />
        <span>VEIL BROWSER</span>
      </div>

      <div className="browser-header__nav-controls">
        <button className="nav-btn" title="Back">
          <ArrowLeft size={16} />
        </button>
        <button className="nav-btn" title="Forward">
          <ArrowRight size={16} />
        </button>
        <button className="nav-btn" onClick={onReload} title="Reload page">
          <RotateCw size={15} />
        </button>
      </div>

      <form className="omnibox" onSubmit={handleSubmit}>
        <Lock size={14} className="omnibox__lock" />
        <input
          type="text"
          className="omnibox__input"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="Enter website URL..."
        />
        <div className="omnibox__shield">
          <ShieldCheck size={13} />
          <span>{sensitiveCount} Redactions Active</span>
        </div>
      </form>
    </div>
  );
};
