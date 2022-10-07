// const express = require('express');
const redstone = require('redstone-api');

const getSTX = async() => {
  const price = await redstone.getPrice('STX');
  console.log(price.value);
  console.log(price.timestamp);
  console.log(price);
}

getSTX();
// const app = express();

// const PORT = 3000;

// app.use(express.json());
// app.use(express.urlencoded());

// app.get('/redstone', (req, res) => {

// })

// app.use('*', (req,res) => {
//   res.status(404).send('Not Found');
// });

// app.listen(PORT, ()=>{ console.log(`Listening on port ${PORT}...`); });

// module.exports = app;