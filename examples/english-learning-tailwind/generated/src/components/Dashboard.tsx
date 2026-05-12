'use client';

import { useEffect, useState } from 'react';

interface Story {
  id: number;
  title: string;
  cefrLevel: string;
}

interface DashboardData {
  streakDays: number;
  cefrLevel: string;
  todayGoal: number;
  todayDone: number;
  recentStoryList: Story[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/el/dashboard')
      .then((res) => res.json())
      .then((json: DashboardData) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div>読み込み中...</div>;
  }

  if (!data) {
    return <div>データを取得できませんでした。</div>;
  }

  return (
    <div>
      <div data-testid="streakDays">{data.streakDays}</div>
      <div data-testid="cefrLevel">{data.cefrLevel}</div>
      <div data-testid="todayGoal">{data.todayGoal}</div>
      <div data-testid="todayDone">{data.todayDone}</div>
      <ul data-testid="recentStoryList">
        {data.recentStoryList.map((story) => (
          <li key={story.id}>{story.title}</li>
        ))}
      </ul>
    </div>
  );
}
