import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Users, Shield, Play, BarChart3, Lock, FileJson, Printer, Globe } from 'lucide-react';

import Lobby from './components/Lobby';
import Participant from './components/Participant';
import AdminDashboard from './components/AdminDashboard';
import LiveScreen from './components/LiveScreen';
import ReportView from './components/ReportView';
import { t } from './i18n';

export default function App() {
  const [role, setRole] = useState('lobby'); // lobby, participant, admin, livescreen, report
  const [sessionState, setSessionState] = useState({
    question: '',
    status: 'active',
    statements: [],
    analysis: null,
    participantsCount: 0,
    targetK: 3,
    aiAccuracy: 0,
    visibility: 'PUBLIC',
    passwordText: null
  });

  const [participant, setParticipant] = useState(null);
  const [activeSessionCode, setActiveSessionCode] = useState('DEFAULT');
  const [isModerator, setIsModerator] = useState(false);
  const [moderationQueue, setModerationQueue] = useState([]);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);

  const [isConnected, setIsConnected] = useState(true);
  const [participants, setParticipants] = useState([]);
  const offlineVotesQueue = useRef([]);
  const [sessionsOverview, setSessionsOverview] = useState([]);
  const [lang, setLang] = useState(localStorage.getItem('muzakere_lang') || 'tr');
  const [theme, setTheme] = useState(localStorage.getItem('muzakere_theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-ui-mode', 'modern');
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
    localStorage.setItem('muzakere_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    if (role === 'admin' && isAdminAuthenticated) {
      const token = localStorage.getItem('admin_token');
      if (token) {
        fetch('/api/admin/sessions-overview', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setSessionsOverview(data.overview || data.sessions || []);
          }
        })
        .catch(err => console.error('Meta-analysis load error:', err));
      }
    }
  }, [role, isAdminAuthenticated, activeSessionCode]);

  const socketRef = useRef(null);

  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://m-zakere-masas-son-1.onrender.com';
    const socket = io(backendUrl);
    socketRef.current = socket;

    socket.on('session-state', (state) => {
      setSessionState(prev => ({
        ...prev,
        question: state.question,
        status: state.status,
        statements: state.statements,
        analysis: state.analysis,
        participantsCount: state.participantsCount,
        visibility: state.visibility || 'PUBLIC',
        passwordText: state.passwordText || null
      }));
    });

    socket.on('ai-moderation-accuracy', (accuracy) => {
      setSessionState(prev => ({
        ...prev,
        aiAccuracy: accuracy
      }));
    });

    socket.on('stats-update', ({ participantsCount }) => {
      setSessionState(prev => ({ ...prev, participantsCount }));
    });

    socket.on('question-updated', (question) => {
      setSessionState(prev => ({ ...prev, question }));
    });

    socket.on('new-statement', (statement) => {
      setSessionState(prev => ({
        ...prev,
        statements: [...prev.statements, statement]
      }));
    });

    socket.on('analysis-update', (analysis) => {
      setSessionState(prev => ({ ...prev, analysis }));
    });

    socket.on('auth-error', (err) => {
      alert(err.message || 'Oturum yetkiniz sona erdi. Lütfen tekrar giriş yapın.');
      localStorage.removeItem('muzakere_participant');
      setParticipant(null);
      setIsModerator(false);
      setActiveSessionCode('DEFAULT');
      setRole('lobby');
    });

    socket.on('moderation-queue', (queue) => {
      setModerationQueue(queue);
    });

    socket.on('opinion_moderated', ({ id, status }) => {
      if (status === 'REJECTED') {
        setSessionState(prev => ({
          ...prev,
          statements: prev.statements.filter(st => st.id !== id)
        }));
      }
    });

    socket.on('session-reset', (state) => {
      setSessionState({
        question: state.question,
        status: state.status,
        statements: state.statements,
        analysis: state.analysis,
        participantsCount: state.participantsCount
      });
      setParticipant(null);
      setIsModerator(false);
      localStorage.removeItem('muzakere_participant');
      setRole('lobby');
    });

    socket.on('session-settings-updated', ({ visibility, passwordText }) => {
      console.log('Masa erişim ayarları güncellendi:', visibility, passwordText);
      setSessionState(prev => ({ ...prev, visibility, passwordText }));
    });

    socket.on('session-status-updated', ({ status }) => {
      setSessionState(prev => ({ ...prev, status }));
    });

    socket.on('statement-deleted', ({ id }) => {
      setSessionState(prev => ({
        ...prev,
        statements: prev.statements.filter(st => st.id !== id)
      }));
    });

    socket.on('statement-edited', ({ statement }) => {
      setSessionState(prev => ({
        ...prev,
        statements: prev.statements.map(st => st.id === statement.id ? statement : st)
      }));
    });

    socket.on('connect', () => {
      setIsConnected(true);
      
      const savedPartStr = localStorage.getItem('muzakere_participant');
      if (savedPartStr && offlineVotesQueue.current.length > 0) {
        try {
          const savedPart = JSON.parse(savedPartStr);
          console.log(`🔌 Bağlantı kuruldu, ${offlineVotesQueue.current.length} adet bekleyen oy eşitleniyor...`);
          offlineVotesQueue.current.forEach(({ statementId, voteValue }) => {
            socket.emit('submit-vote', {
              sessionCode: savedPart.sessionCode || 'DEFAULT',
              participantId: savedPart.id,
              statementId,
              voteValue
            });
          });
          offlineVotesQueue.current = [];
        } catch (e) {
          console.error('Offline oylar eşitlenirken hata:', e);
        }
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('participants-list', (list) => {
      setParticipants(list);
    });

    socket.on('participant-kicked', ({ participantId }) => {
      const savedPartStr = localStorage.getItem('muzakere_participant');
      if (savedPartStr) {
        try {
          const savedPart = JSON.parse(savedPartStr);
          if (savedPart.id === participantId) {
            localStorage.removeItem('muzakere_participant');
            setParticipant(null);
            setIsModerator(false);
            setRole('lobby');
            alert('⚖️ Müzakere Masası: Moderatör tarafından masadan çıkarıldınız.');
          }
        } catch (e) {
          // ignore
        }
      }
    });

    // Rota Kontrolü: Doğrudan /live veya /live/:code ile girilmiş mi?
    const path = window.location.pathname;
    const isLivePath = path === '/live' || path.startsWith('/live/');
    let matchedCode = null;
    if (isLivePath) {
      const parts = path.split('/');
      matchedCode = parts[2] ? parts[2].toUpperCase() : 'DEFAULT';
    }

    // LocalStorage: Daha önceden oturum açılmış mı?
    const savedParticipant = localStorage.getItem('muzakere_participant');
    const adminToken = localStorage.getItem('admin_token');

    if (isLivePath) {
      let isAuthorized = false;
      let targetCode = matchedCode || 'DEFAULT';
      let resolvedToken = null;

      if (adminToken) {
        isAuthorized = true;
        resolvedToken = adminToken;
      } else {
        const modToken = localStorage.getItem(`moderator_token_${targetCode}`);
        const sessionToken = localStorage.getItem(`session_token_${targetCode}`);
        if (modToken || sessionToken) {
          isAuthorized = true;
          resolvedToken = modToken || sessionToken;
        } else if (savedParticipant) {
          try {
            const parsed = JSON.parse(savedParticipant);
            if ((parsed.sessionCode || 'DEFAULT').toUpperCase() === targetCode) {
              isAuthorized = true;
              resolvedToken = localStorage.getItem(`session_token_${targetCode}`);
            }
          } catch (e) {
            // ignore
          }
        }
      }

      if (isAuthorized) {
        if (savedParticipant) {
          try {
            setParticipant(JSON.parse(savedParticipant));
          } catch (e) {}
        }
        setActiveSessionCode(targetCode);
        const modToken = localStorage.getItem(`moderator_token_${targetCode}`);
        if (modToken) {
          setIsModerator(true);
          socket.emit('admin-join', { sessionCode: targetCode, token: adminToken || modToken });
        }
        socket.emit('join-session', { sessionCode: targetCode, token: resolvedToken });
        setRole('livescreen');
      } else {
        // Yetkisiz veya giriş yapılmamış, lobiye at ve URL'i temizle
        setRole('lobby');
        window.history.replaceState({}, '', '/');
      }
    } else if (savedParticipant) {
      try {
        const parsed = JSON.parse(savedParticipant);
        setParticipant(parsed);
        setActiveSessionCode(parsed.sessionCode || 'DEFAULT');

        // Moderatör kontrolü
        const modToken = localStorage.getItem(`moderator_token_${parsed.sessionCode || 'DEFAULT'}`);
        if (modToken) {
          setIsModerator(true);
          socket.emit('admin-join', { 
            sessionCode: parsed.sessionCode || 'DEFAULT', 
            token: adminToken || modToken 
          });
        }

        if (parsed.token && !localStorage.getItem(`session_token_${parsed.sessionCode || 'DEFAULT'}`)) {
          localStorage.setItem(`session_token_${parsed.sessionCode || 'DEFAULT'}`, parsed.token);
        }

        const savedToken = localStorage.getItem(`session_token_${parsed.sessionCode || 'DEFAULT'}`) ||
                           parsed.token ||
                           modToken ||
                           adminToken;
        socket.emit('join-session', { sessionCode: parsed.sessionCode || 'DEFAULT', token: savedToken });
        setRole('participant');
      } catch {
        localStorage.removeItem('muzakere_participant');
      }
    }

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    // Keep URL in sync with role state
    const path = window.location.pathname;
    if (role === 'livescreen') {
      const targetUrl = `/live/${activeSessionCode}`;
      if (path !== targetUrl) {
        window.history.pushState({}, '', targetUrl);
      }
    } else if (role === 'report') {
      const targetUrl = `/report/${activeSessionCode}`;
      if (path !== targetUrl) {
        window.history.pushState({}, '', targetUrl);
      }
    } else if (role === 'admin') {
      if (path !== '/admin') {
        window.history.pushState({}, '', '/admin');
      }
    } else if (['lobby', 'participant'].includes(role)) {
      if (path !== '/' && path !== '') {
        window.history.pushState({}, '', '/');
      }
    }
  }, [role, activeSessionCode]);

  // Katılımcı olarak masaya oturma
  const handleJoinSession = ({ sessionCode, nickname, justification, isModerator: isModFlag, token }) => {
    const code = (sessionCode || 'DEFAULT').toUpperCase();

    socketRef.current.emit('join-session', { sessionCode: code, token });
    socketRef.current.emit('register-participant', { sessionCode: code, nickname, justification }, (res) => {
      if (res.success) {
        if (res.token) {
          localStorage.setItem(`session_token_${code}`, res.token);
        }
        const newPart = {
          id: res.participantId,
          nickname: res.nickname,
          sessionCode: code,
          token: res.token || null,
          votes: {}
        };
        setParticipant(newPart);
        setActiveSessionCode(code);
        localStorage.setItem('muzakere_participant', JSON.stringify(newPart));

        if (isModFlag) {
          setIsModerator(true);
          socketRef.current.emit('admin-join', { 
            sessionCode: code, 
            token: localStorage.getItem('admin_token') || localStorage.getItem('moderator_token_' + code) 
          });
        }

        setRole('participant');
      } else {
        alert(res.message || (lang === 'tr' ? 'Giriş başarısız.' : 'Join failed.'));
      }
    });
  };

  // Görüş gönderme (Socket üzerinden)
  const handleSubmitStatement = (text, callback) => {
    if (!participant) return;
    socketRef.current.emit('submit-statement', {
      sessionCode: activeSessionCode,
      participantId: participant.id,
      text
    }, callback);
  };

  // Görüş oylama
  const handleVote = (statementId, voteValue) => {
    if (!participant) return;

    const updatedVotes = { ...participant.votes, [statementId]: voteValue };
    const updatedPart = { ...participant, votes: updatedVotes };
    setParticipant(updatedPart);
    localStorage.setItem('muzakere_participant', JSON.stringify(updatedPart));

    // Çevrimdışı isek oyu kuyruğa ekle
    if (!isConnected) {
      console.log(`🔌 Çevrimdışı oy algılandı. Görüş [${statementId}] oyu kuyruğa alındı.`);
      offlineVotesQueue.current.push({ statementId, voteValue });
      return;
    }

    socketRef.current.emit('submit-vote', {
      sessionCode: activeSessionCode,
      participantId: participant.id,
      statementId,
      voteValue
    }, (res) => {
      if (res && !res.success) {
        console.error('Oy gönderilemedi:', res.message);
      }
    });
  };

  // Masadan kalkma
  const handleLogoutParticipant = () => {
    if (participant && socketRef.current) {
      socketRef.current.emit('leave-session', {
        sessionCode: activeSessionCode,
        participantId: participant.id
      });
    }
    localStorage.removeItem('muzakere_participant');
    setParticipant(null);
    setIsModerator(false);
    setActiveSessionCode('DEFAULT');
    setRole('lobby');
  };

  // Moderatör: görüş onaylama (Socket)
  const handleApproveStatement = (statementId) => {
    socketRef.current.emit('admin-approve-statement', { sessionCode: activeSessionCode, statementId });
  };

  // Moderatör: görüş reddetme (Socket)
  const handleRejectStatement = (statementId) => {
    socketRef.current.emit('admin-reject-statement', { sessionCode: activeSessionCode, statementId });
  };

  // --- ADMIN KONTROLLERİ ---
  const handleAdminLoginSubmit = (e) => {
    e.preventDefault();
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, password: adminPassword })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        localStorage.setItem('admin_token', data.token);
        setIsAdminAuthenticated(true);
        setShowAdminAuthModal(false);
        setRole('admin');
        socketRef.current.emit('admin-join', { 
          sessionCode: activeSessionCode, 
          token: data.token || localStorage.getItem('admin_token') || localStorage.getItem('moderator_token_' + activeSessionCode) 
        });
      } else {
        alert(lang === 'tr' ? 'Hatalı Kullanıcı Adı veya Şifre!' : 'Invalid Username or Password!');
      }
    })
    .catch(() => alert('Sunucu bağlantı hatası'));
  };

  const handleUpdateQuestion = (newQuestion) => {
    socketRef.current.emit('admin-update-question', { sessionCode: activeSessionCode, newQuestion });
  };

  const handleUpdateSessionStatus = (status) => {
    socketRef.current.emit('admin-update-session-status', { sessionCode: activeSessionCode, status });
  };

  const handleAdminApproveStatement = (statementId) => {
    socketRef.current.emit('admin-approve-statement', { sessionCode: activeSessionCode, statementId });
  };

  const handleAdminRejectStatement = (statementId) => {
    socketRef.current.emit('admin-reject-statement', { sessionCode: activeSessionCode, statementId });
  };

  const handleRunSimulation = (count, callback) => {
    socketRef.current.emit('admin-run-simulation', { sessionCode: activeSessionCode, count }, callback);
  };

  const handleResetSession = (callback) => {
    socketRef.current.emit('admin-reset-session', { sessionCode: activeSessionCode }, callback);
  };

  const handleKickParticipant = (participantId) => {
    socketRef.current.emit('admin-kick-participant', { sessionCode: activeSessionCode, participantId });
  };

  const handleUpdateCampsCount = (targetK) => {
    socketRef.current.emit('admin-update-camps-count', { sessionCode: activeSessionCode, targetK });
  };

  const handleRenameCamp = (campId, newName) => {
    socketRef.current.emit('admin-rename-camp', { sessionCode: activeSessionCode, campId, newName });
  };

  const handleToggleLang = (selectedLang) => {
    localStorage.setItem('muzakere_lang', selectedLang);
    setLang(selectedLang);
  };

  const handleSelectSession = (code) => {
    const upperCode = code.toUpperCase();
    setActiveSessionCode(upperCode);
    
    // Admin odasına yeni kodla katıl
    socketRef.current.emit('admin-join', { 
      sessionCode: upperCode, 
      token: localStorage.getItem('admin_token') || localStorage.getItem('moderator_token_' + upperCode) 
    });
    
    // session-state ve diğer veriler socket üzerinden otomatik güncellenecektir
  };

  const handleOpenAdminPanel = () => {
    if (isAdminAuthenticated) {
      setRole('admin');
      socketRef.current.emit('admin-join', { 
        sessionCode: activeSessionCode, 
        token: localStorage.getItem('admin_token') || localStorage.getItem('moderator_token_' + activeSessionCode) 
      });
    } else {
      setShowAdminAuthModal(true);
    }
  };

  // JSON Rapor İndirme
  const handleDownloadReport = async () => {
    try {
      const token = localStorage.getItem(`session_token_${activeSessionCode}`) ||
                    localStorage.getItem(`moderator_token_${activeSessionCode}`) ||
                    localStorage.getItem('admin_token');
      const res = await fetch(`/api/sessions/${activeSessionCode}/report`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `muzakere_rapor_${activeSessionCode}_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Rapor indirme hatası: ' + err.message);
    }
  };

  return (
    <div className="app-container">
      {/* Üst Menü / Navbar */}
      <header className="app-header no-print">
        <div className="app-header-inner">
          {/* 1. TOP-LEFT: Server Connection Status Indicator */}
          <div className="header-left">
            <span className={`status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}`}>
              {isConnected ? t('connConnected', lang) : t('connDisconnected', lang)}
            </span>
          </div>

          {/* 2. CENTERED GROUP: Custom Swiss Geometric Deliberation Logo SVG + Title + Nav Tabs */}
          <div className="header-center">
            <div className="brand" onClick={() => setRole(participant ? 'participant' : 'lobby')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <svg className="brand-logo-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                <rect x="3" y="3" width="12" height="12" rx="3" fill="var(--color-secondary)" fillOpacity="0.9" />
                <rect x="9" y="9" width="12" height="12" rx="3" fill="var(--text-main)" fillOpacity="0.85" stroke="var(--bg-main)" strokeWidth="1.5" />
              </svg>
              <div>
                <div className="brand-title">{t('brandTitle', lang)}</div>
                <div className="brand-subtitle">
                  {activeSessionCode !== 'DEFAULT' ? `CODE: ${activeSessionCode}` : t('brandSubtitle', lang)}
                </div>
              </div>
            </div>

            <nav className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button 
                onClick={() => setRole(participant ? 'participant' : 'lobby')} 
                className={`nav-btn ${['lobby', 'participant'].includes(role) ? 'active' : ''}`}
              >
                <Users size={16} /> {t('navTable', lang)}
              </button>
              
              {(participant || isAdminAuthenticated || isModerator) && (
                <button 
                  onClick={() => setRole('livescreen')} 
                  className={`nav-btn ${role === 'livescreen' ? 'active' : ''}`}
                >
                  <Play size={16} /> {t('navLive', lang)}
                </button>
              )}

              {/* Rapor Butonları (Admin veya Moderatör için) */}
              {(isAdminAuthenticated || isModerator) && (
                <>
                  <button 
                    onClick={() => setRole('report')} 
                    className={`nav-btn ${role === 'report' ? 'active' : ''}`}
                  >
                    <BarChart3 size={16} /> {t('navReport', lang)}
                  </button>
                  <button 
                    onClick={handleDownloadReport}
                    className="nav-btn"
                    title={t('navJsonReport', lang)}
                  >
                    <FileJson size={16} /> {t('navJsonReport', lang)}
                  </button>
                  <button 
                    onClick={() => window.print()}
                    className="nav-btn"
                    title={t('navPrint', lang)}
                  >
                    <Printer size={16} /> {t('navPrint', lang)}
                  </button>
                </>
              )}

              {(isAdminAuthenticated || role !== 'participant') && (
                <button 
                  onClick={handleOpenAdminPanel} 
                  className={`nav-btn ${role === 'admin' ? 'active' : ''}`}
                >
                  <Shield size={16} /> {t('navAdminPanel', lang)}
                </button>
              )}
            </nav>
          </div>

          {/* 3. TOP-RIGHT UTILITY CONTROLS: TR/EN + Theme Toggle + UI Selector */}
          <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ display: 'flex', gap: '0.2rem' }}>
              <button 
                onClick={() => handleToggleLang('tr')} 
                className={`nav-btn ${lang === 'tr' ? 'active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', minWidth: 'auto' }}
              >
                TR
              </button>
              <button 
                onClick={() => handleToggleLang('en')} 
                className={`nav-btn ${lang === 'en' ? 'active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', minWidth: 'auto' }}
              >
                EN
              </button>
            </div>

            {/* Tema Seçici */}
            <button
              onClick={toggleTheme}
              className="nav-btn"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', minWidth: 'auto' }}
              title={lang === 'tr' ? 'Temayı Değiştir' : 'Toggle Theme'}
            >
              {theme === 'light' ? '🌙 Koyu' : '☀️ Açık'}
            </button>
          </div>
        </div>
      </header>

      {/* Ana İçerik Alanı */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {role === 'lobby' && (
          <Lobby 
            question={sessionState.question} 
            participantsCount={sessionState.participantsCount}
            onJoin={handleJoinSession} 
            lang={lang}
          />
        )}

        {role === 'participant' && participant && (
          <Participant 
            participant={participant}
            statements={sessionState.statements}
            analysis={sessionState.analysis}
            onSubmitStatement={handleSubmitStatement}
            onVote={handleVote}
            onLogout={handleLogoutParticipant}
            isModerator={isModerator}
            sessionCode={activeSessionCode}
            moderationQueue={moderationQueue}
            onApproveStatement={handleApproveStatement}
            onRejectStatement={handleRejectStatement}
            status={sessionState.status}
            onUpdateSessionStatus={handleUpdateSessionStatus}
            participants={participants}
            onKickParticipant={handleKickParticipant}
            lang={lang}
            visibility={sessionState.visibility}
            passwordText={sessionState.passwordText}
          />
        )}

        {role === 'admin' && isAdminAuthenticated && (
          <AdminDashboard 
            activeSessionCode={activeSessionCode}
            onSelectSession={handleSelectSession}
            question={sessionState.question}
            moderationQueue={moderationQueue}
            stats={{
              participantsCount: sessionState.participantsCount,
              statementsCount: sessionState.statements.length
            }}
            status={sessionState.status}
            aiAccuracy={sessionState.aiAccuracy}
            onUpdateSessionStatus={handleUpdateSessionStatus}
            onUpdateQuestion={handleUpdateQuestion}
            onApproveStatement={handleAdminApproveStatement}
            onRejectStatement={handleAdminRejectStatement}
            onRunSimulation={handleRunSimulation}
            onResetSession={handleResetSession}
            onOpenLiveScreen={() => setRole('livescreen')}
            onOpenReport={() => setRole('report')}
            participants={participants}
            onKickParticipant={handleKickParticipant}
            targetK={sessionState.analysis?.targetK || 3}
            camps={sessionState.analysis?.camps || []}
            onUpdateCampsCount={handleUpdateCampsCount}
            onRenameCamp={handleRenameCamp}
            lang={lang}
            sessionsOverview={sessionsOverview}
            analysis={sessionState.analysis}
            statements={sessionState.statements}
          />
        )}

        {role === 'livescreen' && (
          <LiveScreen 
            question={sessionState.question}
            analysis={sessionState.analysis}
            statements={sessionState.statements}
            stats={{
              participantsCount: sessionState.participantsCount,
              statementsCount: sessionState.statements.length
            }}
            status={sessionState.status}
            lang={lang}
          />
        )}

        {role === 'report' && (
          <ReportView 
            sessionCode={activeSessionCode}
            onBack={() => setRole(isAdminAuthenticated ? 'admin' : 'participant')}
            lang={lang}
          />
        )}
      </main>

      {/* Admin Giriş Modalı */}
      {showAdminAuthModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 2, 10, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <Lock size={36} style={{ color: 'var(--color-primary)', marginBottom: '0.75rem' }} />
              <h2>{t('adminModalTitle', lang)}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {t('adminModalDesc', lang)}
              </p>
            </div>

            <form onSubmit={handleAdminLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">{lang === 'tr' ? 'Kullanıcı Adı' : 'Username'}</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder={lang === 'tr' ? 'Kullanıcı adınızı girin' : 'Enter your username'} 
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('adminModalPassLabel', lang)}</label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder={t('adminModalPassPlaceholder', lang)} 
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                />
              </div>
              
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  onClick={() => setShowAdminAuthModal(false)} 
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  {t('adminModalCancel', lang)}
                </button>
                <button 
                  type="submit" 
                  className="btn"
                  style={{ flex: 1 }}
                >
                  {t('adminModalSubmit', lang)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
