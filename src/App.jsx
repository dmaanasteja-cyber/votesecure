import { useState } from "react";
import {
  HashRouter,
  Routes,
  Route,
  Link,
  useNavigate,
} from "react-router-dom";
import "./App.css";

const KEY = "votesecure_data";

function readData() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {
      elections: [],
      votes: {},
    };
  } catch {
    return { elections: [], votes: {} };
  }
}

function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function Home() {
  return (
    <main className="hero">
      <span className="eyebrow">SECURE DIGITAL ELECTIONS</span>
      <h1>Every vote matters</h1>
      <p>A simple and transparent online voting platform.</p>
      <div className="actions">
        <Link className="btn" to="/voter">Voter portal</Link>
        <Link className="btn secondary" to="/admin">Admin portal</Link>
      </div>
    </main>
  );
}

function Admin() {
  const [data, setData] = useState(readData);
  const [title, setTitle] = useState("");
  const [names, setNames] = useState("");
  const [message, setMessage] = useState("");

  function createElection(event) {
    event.preventDefault();

    const candidates = names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    if (candidates.length < 2) {
      setMessage("Add at least two candidates.");
      return;
    }

    const updated = {
      ...data,
      elections: [
        ...data.elections,
        {
          id: Date.now().toString(),
          title: title.trim(),
          candidates: candidates.map((name, i) => ({
            id: `${Date.now()}-${i}`,
            name,
          })),
        },
      ],
    };

    saveData(updated);
    setData(updated);
    setTitle("");
    setNames("");
    setMessage("Election created successfully.");
  }

  function deleteElection(id) {
    const updated = {
      ...data,
      elections: data.elections.filter((e) => e.id !== id),
    };

    saveData(updated);
    setData(updated);
  }

  return (
    <main className="page">
      <div className="page-heading">
        <span className="eyebrow">ADMINISTRATION</span>
        <h1>Admin dashboard</h1>
        <p>Create elections and manage candidates.</p>
      </div>

      <section className="card">
        <h2>Create an election</h2>
        <form onSubmit={createElection}>
          <label htmlFor="title">Election name</label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Student Council Election"
          />

          <label htmlFor="candidates">Candidate names</label>
          <textarea
            id="candidates"
            required
            rows="3"
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder="Aarav Sharma, Meera Reddy"
          />

          <p className="hint">Separate names with commas.</p>
          <button className="btn" type="submit">Create election</button>
        </form>
        {message && <p className="message">{message}</p>}
      </section>

      <section className="section">
        <h2>Saved elections ({data.elections.length})</h2>

        {data.elections.map((election) => (
          <article className="card" key={election.id}>
            <h3>{election.title}</h3>
            <p>{election.candidates.length} candidates</p>
            <ul>
              {election.candidates.map((candidate) => (
                <li key={candidate.id}>{candidate.name}</li>
              ))}
            </ul>
            <button
              className="btn danger"
              onClick={() => deleteElection(election.id)}
            >
              Delete election
            </button>
          </article>
        ))}

        {data.elections.length === 0 && (
          <p className="empty">No elections created yet.</p>
        )}
      </section>
    </main>
  );
}

function Voter() {
  const [data, setData] = useState(readData);
  const [search, setSearch] = useState("");
  const [voterId, setVoterId] = useState("");
  const [message, setMessage] = useState("");

  const elections = data.elections.filter((election) => {
    const text = [
      election.title,
      ...election.candidates.map((candidate) => candidate.name),
    ].join(" ").toLowerCase();

    return text.includes(search.toLowerCase());
  });

  function castVote(electionId, candidateId) {
    if (!voterId.trim()) {
      setMessage("Enter your voter ID before voting.");
      return;
    }

    const voteKey = `${electionId}-${voterId.trim().toLowerCase()}`;

    if (data.votes[voteKey]) {
      setMessage("This demo voter has already voted in this election.");
      return;
    }

    const updated = {
      ...data,
      votes: {
        ...data.votes,
        [voteKey]: candidateId,
      },
    };

    saveData(updated);
    setData(updated);
    setMessage("Demo vote recorded.");
  }

  return (
    <main className="page">
      <div className="page-heading">
        <span className="eyebrow">VOTER PORTAL</span>
        <h1>Available elections</h1>
        <p>Find an election and review its candidates.</p>
      </div>

      <section className="card">
        <label htmlFor="voterId">Demo voter ID</label>
        <input
          id="voterId"
          value={voterId}
          onChange={(e) => setVoterId(e.target.value)}
          placeholder="Enter a voter ID"
        />

        <label htmlFor="search">Search elections or candidates</label>
        <input
          id="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
        />
      </section>

      {message && <p className="message">{message}</p>}

      {elections.map((election) => (
        <section className="card election" key={election.id}>
          <h2>{election.title}</h2>
          <p>Select a candidate to cast your demo vote.</p>

          {election.candidates.map((candidate) => (
            <div className="candidate" key={candidate.id}>
              <span>{candidate.name}</span>
              <button
                className="btn"
                onClick={() => castVote(election.id, candidate.id)}
              >
                Vote
              </button>
            </div>
          ))}
        </section>
      ))}

      {elections.length === 0 && (
        <p className="empty">No matching elections found.</p>
      )}
    </main>
  );
}

function App() {
  return (
    <HashRouter>
      <div className="app">
        <header className="navbar">
          <Link to="/" className="brand">VoteSecure</Link>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/voter">Voter</Link>
            <Link to="/admin">Admin</Link>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/voter" element={<Voter />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>

        <footer className="footer">
          VoteSecure · Hackathon demo
        </footer>
      </div>
    </HashRouter>
  );
}

export default App;
