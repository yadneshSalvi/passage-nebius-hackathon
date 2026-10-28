import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Command,
  ExternalLink,
  GitBranch,
  Menu,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { BootstrapData, RepairRun } from "../shared/types";
import { api } from "./api";
import { Mark, Notice, busyStatuses } from "./ui";
import {
  Welcome,
  JourneyGallery,
  NewJourney,
  RunLibrary,
  Settings,
} from "./pages";
import {
  RepairLayout,
  Workbench,
  ContractEditor,
  ChallengeStudio,
  Review,
  EvidenceReport,
} from "./repair";

type Store = {
  data: BootstrapData | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  updateRun: (run: RepairRun) => void;
  repository: () => void;
};
const Context = createContext<Store | null>(null);
export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error("Passage context unavailable");
  return value;
}
function Dialog({
  open,
  close,
  title,
  children,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      aria-labelledby={titleId}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [repoOpen, setRepoOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    try {
      const next = await api<BootstrapData>("/bootstrap");
      setData(next);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The local service is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  const updateRun = useCallback(
    (run: RepairRun) =>
      setData((previous) =>
        previous
          ? {
              ...previous,
              runs: [run, ...previous.runs.filter((r) => r.id !== run.id)],
            }
          : previous,
      ),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => {
      if (data?.runs.some((run) => busyStatuses.includes(run.status)))
        void refresh();
    }, 3500);
    return () => clearInterval(id);
  }, [data?.runs, refresh]);
  useEffect(() => {
    setMobileOpen(false);
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.contrast = data?.settings.highContrast
      ? "high"
      : "normal";
    document.documentElement.dataset.motion = data?.settings.reduceMotion
      ? "reduced"
      : "normal";
  }, [data?.settings]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const commands = [
    { label: "Start a new journey", path: "/journeys/new" },
    { label: "Explore sample journeys", path: "/journeys" },
    { label: "Open repairs", path: "/repairs" },
    { label: "Browse evidence", path: "/evidence" },
    { label: "Settings and connections", path: "/settings" },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Context.Provider
      value={{
        data,
        loading,
        error,
        refresh,
        updateRun,
        repository: () => setRepoOpen(true),
      }}
    >
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Passage home">
          <Mark />
          <span>
            passage<span className="brand-period">.</span>
          </span>
        </Link>
        <nav
          className={mobileOpen ? "primary-nav mobile-open" : "primary-nav"}
          aria-label="Primary navigation"
        >
          <NavLink to="/journeys">Journeys</NavLink>
          <NavLink to="/repairs">Repairs</NavLink>
          <NavLink to="/evidence">Evidence</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="header-actions">
          <button
            className="command-button"
            aria-label="Search actions, Command K"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={16} />
            <span>Quick find</span>
            <kbd>⌘ K</kbd>
          </button>
          <Link className="button button-small" to="/journeys/new">
            <Plus size={16} />
            <span>New journey</span>
          </Link>
          <button
            className="icon-button mobile-menu"
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {error ? (
        <div className="connection-banner" role="status">
          <span>
            Connection interrupted.{" "}
            {data
              ? "Your last saved evidence is still available."
              : "Start the local API to load samples and saved runs."}
          </span>
          <button onClick={() => void refresh()}>
            Reconnect <ArrowRight size={14} />
          </button>
        </div>
      ) : null}
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/journeys" element={<JourneyGallery />} />
          <Route path="/journeys/new" element={<NewJourney />} />
          <Route
            path="/journeys/:id"
            element={<RepairLayout journeyRedirect />}
          />
          <Route path="/repairs" element={<RunLibrary />} />
          <Route path="/repairs/:id" element={<RepairLayout />}>
            <Route index element={<Workbench />} />
            <Route path="contract" element={<ContractEditor />} />
            <Route path="challenges" element={<ChallengeStudio />} />
            <Route path="review" element={<Review />} />
          </Route>
          <Route path="/evidence" element={<RunLibrary evidence />} />
          <Route path="/evidence/:id" element={<EvidenceReport />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <div className="page narrow">
                <h1>A little off the path.</h1>
                <p>This page could not be found.</p>
                <Link to="/" className="button">
                  Return to Passage <ArrowRight size={18} />
                </Link>
              </div>
            }
          />
        </Routes>
      </main>
      {!location.pathname.match(/^\/repairs\//) ? (
        <footer className="site-footer">
          <Link to="/" className="brand footer-brand">
            <Mark />
            <span>passage.</span>
          </Link>
          <p>Better access. In the source.</p>
          <span className="footer-note">
            An engineering prototype. Human validation pending.
          </span>
          <Link to="/settings">
            Scope & connections <ArrowRight size={14} />
          </Link>
        </footer>
      ) : null}
      <Dialog
        open={repoOpen}
        close={() => setRepoOpen(false)}
        title="Bring a journey into Passage"
      >
        <div className="repo-dialog-icon">
          <GitBranch size={28} />
        </div>
        <p className="lead">Start with a scoped, reproducible application.</p>
        <p>
          This local edition supports the authored React fixtures in the sample
          library. Each has an immutable source, fictional data, and independent
          interaction checks.
        </p>
        <Notice title="Repository import is not connected">
          Arbitrary repository execution and draft pull requests are unavailable
          in this local environment. Export a reviewed source patch to apply in
          your own repository.
        </Notice>
        <div className="dialog-actions">
          <button
            className="button"
            onClick={() => {
              setRepoOpen(false);
              navigate("/journeys");
            }}
          >
            Explore supported samples <ArrowRight size={17} />
          </button>
          <button
            className="button button-secondary"
            onClick={() => {
              setRepoOpen(false);
              navigate("/settings");
            }}
          >
            View environment
          </button>
        </div>
      </Dialog>
      <Dialog
        open={commandOpen}
        close={() => setCommandOpen(false)}
        title="Find your next step"
      >
        <label className="search-field">
          <Search size={19} />
          <input
            autoFocus
            aria-label="Search actions"
            placeholder="Search journeys, repairs, settings…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="command-list">
          {commands.length ? (
            commands.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  setCommandOpen(false);
                  setQuery("");
                  navigate(item.path);
                }}
              >
                {item.label}
                <ArrowRight size={17} />
              </button>
            ))
          ) : (
            <p className="muted">
              No matching action. Try “journey” or “settings”.
            </p>
          )}
        </div>
        <p className="small muted">
          <Command size={13} /> All actions are also available in the
          navigation.
        </p>
      </Dialog>
    </Context.Provider>
  );
}
