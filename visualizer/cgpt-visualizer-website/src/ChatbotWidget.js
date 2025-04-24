import React, { useState, useRef, useEffect } from 'react';

const API_URL = 'http://localhost:8010/chat'; // NEW backend endpoint for chatbot
const API_KEY = process.env.REACT_APP_ANTHROPIC_API_KEY;

const ChatbotWidget = () => {
  const [messages, setMessages] = useState([
    { sender: 'bot', text: "Hello! I can help answer questions about the genome you're viewing." }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage = { sender: 'user', text: input };
    setMessages((msgs) => [...msgs, userMessage]);
    setLoading(true);
    setInput('');
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (API_KEY) {
        headers['x-api-key'] = API_KEY;
      }
      const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: input })
      });
      const data = await res.json();
      let botReply = '';
      if (data.result) {
        botReply = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
      } else if (data.error) {
        botReply = 'Error: ' + data.error;
      } else {
        botReply = 'Sorry, I did not understand the response.';
      }
      setMessages((msgs) => [...msgs, { sender: 'bot', text: botReply }]);
    } catch (err) {
      setMessages((msgs) => [...msgs, { sender: 'bot', text: 'Error connecting to the backend.' }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              background: msg.sender === 'user' ? '#e9f5e9' : '#f0f6ff',
              borderRadius: 8,
              padding: '12px 18px',
              fontSize: 16,
              color: '#222',
              maxWidth: '80%',
              whiteSpace: 'pre-wrap',
              boxShadow: msg.sender === 'user' ? '0 1px 4px rgba(0,128,0,0.07)' : '0 1px 4px rgba(0,0,128,0.07)'
            }}
          >
            {msg.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <textarea
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your genomics question..."
          style={{ flex: 1, borderRadius: 8, border: '1px solid #d0d6e0', padding: '10px 14px', fontSize: 15, resize: 'none', outline: 'none', background: '#f9fafd' }}
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{ background: '#2a7be4', color: '#fff', border: 'none', borderRadius: 8, padding: '0 18px', fontWeight: 500, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer', height: 42 }}
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default ChatbotWidget;
