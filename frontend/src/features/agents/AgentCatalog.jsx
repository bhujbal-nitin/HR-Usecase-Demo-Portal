import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentIcon from './data/AgentIcon';
import { AGENTS, CATEGORIES } from './data/agentRegistry';

function matches(agent, category, query) {
  if (category !== 'all' && agent.category !== category) return false;
  if (!query) return true;
  const haystack = [agent.name, agent.catalogName, agent.description, ...agent.tags].join(' ').toLowerCase();
  return haystack.includes(query);
}

function AgentCard({ agent, onOpen }) {
  return (
    <div className="agent-catalog-card">
      <div className="agent-card-icon-wrapper"><AgentIcon agentId={agent.id} /></div>
      <div className="agent-card-header">
        <h3 className="agent-card-title">{agent.catalogName}</h3>
        <span className="agent-card-badge">{agent.badge}</span>
      </div>
      <p className="agent-card-desc">{agent.description}</p>
      <div className="agent-card-tags">
        {agent.tags.map((tag) => <span key={tag} className="agent-tag-pill">{tag}</span>)}
      </div>
      <div className="agent-card-footer">
        <button type="button" className="btn-live-demo" onClick={() => onOpen(agent.id)}>
          <i className="fa-solid fa-play"></i> Live Demo
        </button>
      </div>
    </div>
  );
}

export default function AgentCatalog() {
  const navigate = useNavigate();
  // Live Demo opens the full two-screen demo page for that agent and starts it.
  const open = (agentId) => navigate(`/agent-demo/${agentId}`, { state: { autoplay: Date.now() } });
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => AGENTS.filter((agent) => matches(agent, category, query)), [category, query]);

  return (
    <section className="view-section active">
      <div className="agent-hero-banner">
        <div className="agent-hero-title-group">
          <div className="agent-hero-tag"><i className="fa-solid fa-sparkles"></i> Autonomous Enterprise GenAI</div>
          <h1 className="agent-hero-title">HR AI Agents</h1>
          <p className="agent-hero-desc">
            Explore our autonomous HR AI Agents catalog below. Click <strong>Live Demo</strong> on any agent card to
            launch an interactive chatbot session where you can execute real employee workflows across OrangeHRMS,
            Active Directory, ServiceNow &amp; AutomationEdge.
          </p>
        </div>
      </div>

      <div className="catalog-controls">
        <div className="catalog-search-wrapper">
          <i className="fa-solid fa-magnifying-glass"></i>
          <input
            type="text"
            className="catalog-search-input"
            placeholder="Search HR AI Agent by name, usecase or capability..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search agents"
          />
        </div>
        <div className="catalog-filter-tags">
          {CATEGORIES.map(({ id, label }) => (
            <button key={id} type="button" className={`catalog-filter-btn${category === id ? ' active' : ''}`} onClick={() => setCategory(id)}>
              {id === 'all' ? `${label} (${AGENTS.length})` : label}
            </button>
          ))}
        </div>
      </div>

      <div className="agent-catalog-grid">
        {visible.length === 0 ? (
          <div className="empty-catalog">
            <i className="fa-solid fa-magnifying-glass"></i>
            <h4>No matching AI agents found</h4>
            <p>Try clearing the search or switching categories.</p>
          </div>
        ) : (
          visible.map((agent) => <AgentCard key={agent.id} agent={agent} onOpen={open} />)
        )}
      </div>
    </section>
  );
}
