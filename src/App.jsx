import { useState } from "react";
import {
  HashRouter,
  Routes,
  Route,
  Link,
} from "react-router-dom";
import "./App.css";

const STORAGE_KEY = "votesecure_elections";

// Retrieve saved elections from localStorage
function getElections() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

// Save elections to localStorage
function saveElections(elections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(elections));
}

// Home Page
function Home() {
  return (
    <section className="hero">
      <h1>Every Vote Matters</h1>
      <p>A simple and transparent online voting platform.</p>

      <div>
        <Link to="/voter" className="btn">
          Voter Portal
        </Link>

        <Link to="/admin" className="btn">
          Admin Portal
        </Link>
      </div>
    </section>
  );
}

// Admin Dashboard
function AdminDashboard() {
  const [elections, setElections] = useState(getElections);
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState("");
  const [message, setMessage] = useState("");

  function createElection(event) {
    event.preventDefault();

    const candidateList = candidates
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    if (!title.trim()) {
      setMessage("Please enter an election name.");
      return;
    }

    if (candidateList.length < 2) {
      setMessage("Add at least two candidates.");
      return;
    }

    const newElection = {
      id: Date.now(),
      title: title.trim(),
      candidates: candidateList.map((name, index) => ({
        id: index + 1,
        name,
      })),
      votes: {},
    };

    const updated = [...elections, newElection];

    saveElections(updated);
    setElections(updated);

    setTitle("");
    setCandidates("");
    setMessage("Election created and saved successfully!");
  }

  function deleteElection(id) {
    const updated = elections.filter(
      (election) => election.id !== id
    );

    saveElections(updated);
    setElections(updated);
    setMessage("Election deleted.");
  }

  return (
    <section className="content">
      <h1>Admin Dashboard</h1>
      <p>Create and manage elections.</p>

      <div className="card">
        <h2>Create Election</h2>

        <form onSubmit={createElection}>
          <label>Election Name</label>

          <input
            type="text"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Student Council Election"
          />

          <label>Candidate Names</label>

          <textarea
            required
            rows="3"
            value={candidates}
            onChange={(event) => setCandidates(event.target.value)}
            placeholder="Aarav Sharma, Meera Reddy, Rahul Kumar"
          />

          <p className="hint">
            Separate candidate names using commas.
          </p>

          <button className="btn" type="submit">
            Create Election
          </button>
        </form>

        {message && <p>{message}</p>}
      </div>

      <h2>Saved Elections ({elections.length})</h2>

      {elections.map((election) => (
        <div className="card" key={election.id}>
          <h3>{election.title}</h3>

          <p>
            {election.candidates.length} candidates
          </p>

          <ul>
            {election.candidates.map((candidate) => (
              <li key={candidate.id}>
                {candidate.name}
              </li>
            ))}
          </ul>

          <button
            className="btn danger"
            onClick={() => deleteElection(election.id)}
          >
            Delete Election
          </button>
        </div>
      ))}

      {elections.length === 0 && (
        <p>No elections created yet.</p>
      )}
    </section>
  );
}

// Voter Dashboard
function VoterDashboard() {
  const [elections] = useState(getElections);
  const [search, setSearch] = useState("");

  const filteredElections = elections.filter((election) => {
    const searchableText = [
      election.title,
      ...election.candidates.map((candidate) => candidate.name),
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(search.toLowerCase());
  });

  return (
    <section className="content">
      <h1>Voter Dashboard</h1>

      <p>View elections and retrieve candidate information.</p>

      <input
        className="search-input"
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search elections or candidates..."
      />

      {filteredElections.map((election) => (
        <div className="card" key={election.id}>
          <h2>{election.title}</h2>

          <h3>Candidates</h3>

          <ul>
            {election.candidates.map((candidate) => (
              <li key={candidate.id}>
                {candidate.name}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {filteredElections.length === 0 && (
        <p>No matching elections found.</p>
      )}
    </section>
  );
}

// Main Application
function App() {
  return (
    <HashRouter>
      <div className="app">
        <nav className="navbar">
          <Link to="/" className="brand">
            VoteSecure
          </Link>

          <div>
            <Link to="/" className="nav-link">
              Home
            </Link>

            <Link to="/voter" className="nav-link">
              Voter
            </Link>

            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<Home />} />

          <Route
            path="/voter"
            element={<VoterDashboard />}
          />

          <Route
            path="/admin"
            element={<AdminDashboard />}
          />
        </Routes>
      </div>
    </HashRouter>
  );
}

export default App;
