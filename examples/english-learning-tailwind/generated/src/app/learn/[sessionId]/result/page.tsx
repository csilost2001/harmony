'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface ResultData {
  totalScore: number;
  turnCount: number;
  newWordsCount: number;
  pronunciationFeedback: Array<{ word: string; score: number }>;
  recommendedStory: string;
}

export default function ResultPage() {
  const params = useParams();
  const sessionId = params.sessionId;
  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch(`/api/el/sessions/${sessionId}/result`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((json: ResultData) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) {
    return <div>読み込み中...</div>;
  }

  if (!data) {
    return <div>データを取得できませんでした。</div>;
  }

  return (
    <main>
      <div data-testid="totalScore">{data.totalScore}</div>
      <div data-testid="turnCount">{data.turnCount}</div>
      <div data-testid="newWordsCount">{data.newWordsCount}</div>
      <div data-testid="pronunciationFeedback">
        {data.pronunciationFeedback.map((item, i) => (
          <span key={i}>
            {item.word}: {item.score}
          </span>
        ))}
      </div>
      <div data-testid="recommendedStory">{data.recommendedStory}</div>
    </main>
  );
}
