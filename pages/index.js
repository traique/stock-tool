import { useEffect, useState } from "react";

export default function Home() {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch("/api/prices")
      .then(res => res.json())
      .then(setData);
  }, []);

  return (
    <div>
      <h1>Stock Dashboard</h1>

      {data.map((item, i) => (
        <div key={i}>
          {item.symbol} - {item.price}
        </div>
      ))}
    </div>
  );
}
