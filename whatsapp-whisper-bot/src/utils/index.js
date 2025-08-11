// src/utils/index.js
const handleError = (error, res) => {
  console.error("Error:", error);
  res.status(500).json({ message: "An error occurred", error: error.message });
};

const formatResponse = (data) => {
  return {
    status: "success",
    data,
  };
};

module.exports = {
  handleError,
  formatResponse,
};