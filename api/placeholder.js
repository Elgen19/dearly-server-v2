export default function handler(req, res) {
  return res.status(200).json({
    message: "💖 Project Love backend is live and running!",
    endpoints: ["/api/hello", "/api/send-email"]
  });
}
