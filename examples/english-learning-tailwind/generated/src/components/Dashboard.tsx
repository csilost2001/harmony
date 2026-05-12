'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    fetch('/api/el/dashboard', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((json: DashboardData) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const startLearning = async () => {
    const token = localStorage.getItem('accessToken');
    const res = await fetch('/api/el/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storyId: 1 }),
    });
    const responseData = await res.json();
    if (responseData.sessionId) {
      router.push(`/learn/${responseData.sessionId}`);
    }
  };

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
      <button data-testid="startLearningButton" onClick={startLearning}>
        学習開始
      </button>
    </div>
  );
}
