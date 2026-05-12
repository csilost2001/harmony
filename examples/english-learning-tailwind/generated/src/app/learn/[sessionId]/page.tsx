'use client';
import { useParams } from 'next/navigation';

export default function PlayPage() {
  const params = useParams();
  return <main data-testid="playPage">Session {params.sessionId}</main>;
}
