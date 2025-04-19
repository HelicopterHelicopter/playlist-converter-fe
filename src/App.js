import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BrowserRouter as Router, Route, Routes, useNavigate, useLocation } from 'react-router-dom'; // Import react-router components
import './App.css';

// --- Constants ---
const API_BASE_URL = process.env.REACT_APP_BACKEND_API_BASE_URL || '';

// --- Token Storage ---
// Security Warning: Storing tokens in Local Storage is vulnerable to XSS.
// Consider more secure alternatives for production (e.g., HttpOnly cookies managed by backend-for-frontend, or in-memory with robust refresh).
const ACCESS_TOKEN_KEY = 'spotify_access_token';
const REFRESH_TOKEN_KEY = 'spotify_refresh_token';
const EXPIRY_TIMESTAMP_KEY = 'spotify_expiry_timestamp';

const storeTokens = (accessToken, refreshToken, expiresIn) => {
  if (!accessToken || !expiresIn) {
    console.error("Cannot store tokens: Access token or expires_in missing.");
    return;
  }
  // Calculate expiry time (expiresIn is in seconds)
  const expiryTimestamp = Date.now() + (parseInt(expiresIn, 10) * 1000);
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
     localStorage.removeItem(REFRESH_TOKEN_KEY); // Ensure old one is removed if not provided
  }
  localStorage.setItem(EXPIRY_TIMESTAMP_KEY, expiryTimestamp.toString());
  console.log("Tokens stored. Expiry:", new Date(expiryTimestamp).toLocaleString());
};

const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY);
const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY); // Keep for potential future refresh implementation
const getExpiryTimestamp = () => {
  const timestamp = localStorage.getItem(EXPIRY_TIMESTAMP_KEY);
  return timestamp ? parseInt(timestamp, 10) : null;
};

const clearTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRY_TIMESTAMP_KEY);
  console.log("Tokens cleared.");
};

// Check if token is expired or close to expiring (e.g., within 60 seconds)
const isTokenExpired = () => {
    const expiry = getExpiryTimestamp();
    if (!expiry) return true; // No expiry means we treat it as expired/invalid
    // Check if expiry is in the past or within the next 60 seconds
    return Date.now() >= expiry - (60 * 1000);
};


// --- Axios API Client Setup ---
const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  // REMOVED withCredentials: true - not needed for token auth
  headers: {
    'Content-Type': 'application/json',
  },
});

// Axios Request Interceptor: Adds Authorization header if token exists
apiClient.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    // Add token only if it exists AND is not expired
    if (token && !isTokenExpired()) {
      config.headers['Authorization'] = `Bearer ${token}`;
      console.log("Authorization header added.");
    } else if (token && isTokenExpired()) {
       console.warn("Token exists but is expired. Clearing tokens. Auth header not added.");
       // NOTE: No automatic refresh implemented here. Just clear tokens.
       // User will be logged out on the next status check or API call failure.
       clearTokens();
       // Optionally force logout state update here if needed immediately
    } else {
        console.log("No valid token found. Auth header not added.");
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// --- React Components ---

// Component to handle the redirect from Spotify with tokens in hash
function AuthCallback() {
    const navigate = useNavigate();
    const location = useLocation(); // Use useLocation to get the hash
    const [authError, setAuthError] = useState(null);

    useEffect(() => {
        console.log("AuthCallback mounted. Hash:", location.hash);
        // Use URLSearchParams on the hash part (removing the leading '#')
        const params = new URLSearchParams(location.hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const expiresIn = params.get('expires_in');
        const error = params.get('error');

        if (error) {
            console.error("Authentication error from callback:", error);
            setAuthError(`Login failed: ${error.replace(/_/g, ' ')}. Please try again.`);
            // Optionally clear any potentially stale tokens if error occurs
            clearTokens();
            // Navigate to home, potentially passing error state
            navigate('/', { state: { authError: `Login failed: ${error.replace(/_/g, ' ')}.` } });
        } else if (accessToken && expiresIn) {
            console.log("Tokens received from hash.");
            storeTokens(accessToken, refreshToken, expiresIn);
            // Successfully stored tokens, navigate to the main app page
            navigate('/');
        } else {
            console.warn("No tokens or error found in hash:", location.hash);
            setAuthError("Authentication callback did not provide necessary tokens or error information.");
            // Navigate home even if hash is unexpected
             navigate('/', { state: { authError: "Invalid authentication callback received." } });
        }
        // Run only once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, location.hash]); // Depend on location.hash

    // Display a simple loading/processing message or error
    return (
        <div className="App">
             <header className="App-header">
                 <h1>Authenticating...</h1>
             </header>
             <main>
                {authError && <p className="error-message">Error: {authError}</p>}
                <p>Please wait while we process your login.</p>
             </main>
        </div>
    );
}


// Main Application Component
function MainApp() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [userData, setUserData] = useState(null);
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [playlistName, setPlaylistName] = useState('');
    // Use state for loading indicator during auth check
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [isConverting, setIsConverting] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState(null);
    const location = useLocation(); // Access location state passed from AuthCallback

    // Check for auth errors passed via navigation state from AuthCallback
    useEffect(() => {
      if (location.state?.authError) {
          setError(location.state.authError);
          // Clear the state to avoid showing the error again on refresh
          window.history.replaceState({}, document.title)
      }
    }, [location.state]);


    // --- API Interaction Logic (Using configured Axios client) ---
    const fetchAPI = useCallback(async (endpoint, options = {}) => {
        // Configuration now primarily happens in the axios instance and interceptors
        const config = {
            method: options.method || 'GET',
            url: endpoint,
            data: options.body, // Axios uses 'data' for request body
            headers: {
                ...(options.headers || {}),
            },
        };

        try {
            // Use the pre-configured apiClient instance
            const response = await apiClient(config);
            return response.data;

        } catch (err) {
            console.error('Axios API Error:', err);
            const errorData = err.response?.data;
            const status = err.response?.status;
            let errorMessage = 'An unexpected error occurred.';

            // Specific handling for 401 Unauthorized - likely invalid/expired token
            if (status === 401) {
                console.warn("Received 401 Unauthorized. Clearing tokens and logging out.");
                errorMessage = 'Your session has expired or is invalid. Please log in again.';
                clearTokens(); // Clear invalid tokens
                setIsLoggedIn(false); // Update state immediately
                setUserData(null);
            } else if (errorData) {
                 errorMessage = errorData.message || errorData.error || `Request failed with status ${status}`;
            } else if (err.request) {
                errorMessage = 'No response received from server. Check network or server status.';
            } else {
                errorMessage = err.message;
            }

            setError(errorMessage);
            // Ensure loading states are reset on error
            setIsAuthLoading(false);
            setIsConverting(false);
            return null; // Indicate failure
        }
    }, []); // No dependencies needed

    // --- Authentication Handling ---
    const checkAuthStatus = useCallback(async () => {
        setIsAuthLoading(true);
        setError(null); // Clear previous errors
        //setResults(null); // Maybe keep results?

        const token = getAccessToken();

        if (!token || isTokenExpired()) {
             console.log("No token found or token expired. Clearing any remnants.");
             if(isTokenExpired()){
                console.log("Token expired at:", new Date(getExpiryTimestamp()).toLocaleString());
             }
             clearTokens();
             setIsLoggedIn(false);
             setUserData(null);
             setIsAuthLoading(false);
             return;
        }

        console.log("Token found, checking status with /api/auth/status...");
        try {
            const data = await fetchAPI('/auth/status'); // Interceptor adds token
            if (data && data.user) { // Backend should return user data if token is valid
                console.log("User logged in:", data.user);
                setIsLoggedIn(true);
                setUserData(data.user);
            } else {
                 // This case might indicate a backend issue if status wasn't 401 but no user data came back
                console.warn("/auth/status check returned OK but no user data. Assuming logged out.");
                clearTokens(); // Treat as invalid session
                setIsLoggedIn(false);
                setUserData(null);
            }
        } catch (err) {
             // Error handling (including 401 causing logout) is done within fetchAPI
             console.error("Error during checkAuthStatus (likely handled by fetchAPI):", err);
             // Ensure state reflects logout if fetchAPI failed and set state
             if (isLoggedIn) { // Check current state before potentially overwriting
                 setIsLoggedIn(false);
                 setUserData(null);
             }
        }
        setIsAuthLoading(false);
    }, [fetchAPI, isLoggedIn]); // Add isLoggedIn to deps? Maybe not needed as fetchAPI handles it.


    const handleLogin = () => {
        // Redirect to the backend login endpoint - unchanged
        window.location.href = `${API_BASE_URL}/api/auth/login`;
    };

    const handleLogout = useCallback(() => {
        console.log("Handling logout: Clearing tokens and updating state.");
        clearTokens();
        setIsLoggedIn(false);
        setUserData(null);
        setError(null); // Clear any errors on logout
        setResults(null); // Clear results on logout
    }, []); // No dependencies needed

    // --- Conversion Handling ---
    const handleConvert = async (event) => {
        event.preventDefault();
        setIsConverting(true);
        setError(null);
        setResults(null);

        try {
            const postData = {
                playlist_url: playlistUrl,
                playlist_name: playlistName || 'Converted YouTube Playlist',
            };
            // fetchAPI uses interceptor to add Authorization header
            const data = await fetchAPI('/convert', {
                method: 'POST',
                body: postData,
            });

            if (data && data.success) {
                setResults(data.data);
                setPlaylistUrl('');
                setPlaylistName('');
            } else if (data && data.error) {
                 setError(data.error);
                 if (data.data) {
                    setResults(data.data);
                 }
            }
            // Error handling (including 401) within fetchAPI

        } catch (err) {
           console.error("Error during conversion (likely handled by fetchAPI):", err);
        }
        setIsConverting(false);
    };

    // --- Effects ---
    // Check auth status on initial load
    useEffect(() => {
        checkAuthStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run only once on initial mount

    // Simple HTML escape helper
    const escapeHTML = (str) => {
        if (!str) return '';
        return str.replace(/[&<>'"/]/g, (match) => {
            const escape = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
                '/': '&#x2F;',
            };
            return escape[match];
        });
    };


    // --- Render Logic ---
    // Show loading indicator while checking auth status initially
    if (isAuthLoading) {
         return (
            <div className="App">
                 <header className="App-header">
                     <h1>YouTube Music to Spotify Playlist Converter</h1>
                 </header>
                 <main>
                     <p>Loading authentication status...</p>
                 </main>
            </div>
        );
    }

    return (
        <div className="App">
            <header className="App-header">
                <h1>YouTube Music to Spotify Playlist Converter</h1>
                <div className="auth-section">
                    {/* Removed isLoading check here, using isAuthLoading for initial load */}
                    {isLoggedIn && userData && (
                        <div className="user-info">
                            <span>Logged in as <strong>{userData.display_name || userData.id}</strong></span>
                            {/* Logout uses handleLogout directly */}
                            <button onClick={handleLogout} disabled={isConverting}>Logout</button>
                        </div>
                    )}
                    {!isLoggedIn && (
                        <div className="login-prompt">
                            <p>Please log in with Spotify to convert playlists.</p>
                            {/* Login uses handleLogin directly */}
                            <button onClick={handleLogin} disabled={isConverting}>Login with Spotify</button>
                        </div>
                    )}
                </div>
            </header>

            <main>
                {error && <div className="error-message">Error: {error}</div>}

                {/* Conversion form remains largely the same, depends on isLoggedIn */}
                <form onSubmit={handleConvert} className={`conversion-form ${!isLoggedIn ? 'disabled' : ''}`}>
                    {/* ... form inputs unchanged ... */}
                     <div className="form-group">
                        <label htmlFor="playlist_url">YouTube Music Playlist URL:</label>
                        <input
                            type="url"
                            id="playlist_url"
                            value={playlistUrl}
                            onChange={(e) => setPlaylistUrl(e.target.value)}
                            placeholder="https://music.youtube.com/playlist?list=PL..."
                            required
                            disabled={!isLoggedIn || isConverting}
                        />
                        <small>Make sure the playlist is public.</small>
                    </div>
                    <div className="form-group">
                        <label htmlFor="playlist_name">New Spotify Playlist Name (Optional):</label>
                        <input
                            type="text"
                            id="playlist_name"
                            value={playlistName}
                            onChange={(e) => setPlaylistName(e.target.value)}
                            placeholder="My Awesome Converted Playlist"
                            disabled={!isLoggedIn || isConverting}
                        />
                    </div>
                    <button type="submit" disabled={!isLoggedIn || isConverting || !playlistUrl}>
                        {isConverting ? 'Converting...' : 'Convert Playlist'}
                    </button>
                </form>

                {/* Results section remains the same */}
                {results && (
                    <div className="results-section">
                        {/* ... results display unchanged ... */}
                         <h2>Conversion Results</h2>
                        <div className="result-summary">
                             {results.spotify_playlist_url ? (
                                 <p>Created Spotify playlist:
                                     <a href={results.spotify_playlist_url} target="_blank" rel="noopener noreferrer">
                                         {escapeHTML(results.spotify_playlist_name)}
                                     </a>
                                 </p>
                             ) : (
                                <p>Playlist creation may have failed, or no tracks were found to add.</p>
                             )}
                            <p>Processed {results.total_youtube_tracks ?? 'N/A'} tracks from YouTube.</p>
                            <p>Found {results.found_spotify_tracks ?? 'N/A'} matching tracks on Spotify.</p>
                            {results.spotify_playlist_url && <p>Added {results.tracks_added ?? 'N/A'} tracks to the new playlist.</p>}
                        </div>

                        {results.api_errors && results.api_errors.length > 0 && (
                            <div className="api-errors">
                                <h4>API Issues Encountered:</h4>
                                <ul>
                                    {results.api_errors.map((err, index) => (
                                        <li key={index}>{escapeHTML(err)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.not_found_tracks && results.not_found_tracks.length > 0 && (
                            <div className="not-found">
                                <h4>Tracks Not Found on Spotify:</h4>
                                <ul>
                                    {results.not_found_tracks.map((track, index) => (
                                        <li key={index}>{escapeHTML(track)}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}


// App component now sets up the Router
function App() {
    return (
        <Router>
            <Routes>
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/" element={<MainApp />} />
            </Routes>
        </Router>
    );
}

export default App;
