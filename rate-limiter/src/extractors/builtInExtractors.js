function buildBuiltInExtractors() {
  return {
    ip(req) {
      if (req.ip) {
        return req.ip;
      }

      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        const first = forwarded.split(',')[0].trim();
        if (first) {
          return first;
        }
      }

      return req.socket?.remoteAddress;
    },
    user(req) {
      return req.user && req.user.id;
    },
    session(req) {
      return req.session && req.session.id;
    },
    global() {
      return 'global';
    },
  };
}

module.exports = { buildBuiltInExtractors };
