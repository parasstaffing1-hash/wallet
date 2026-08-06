export interface Job {
  id: string;
  title: string;
  company_id: string;
  status: string;
  remote_policy: string;
  location: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface JobChange {
  id: string;
  job_id: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  changed_at: string;
}

export interface JobsResponse {
  items: Job[];
  total: number;
  page: number;
  size: number;
}

export async function api<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`http://localhost:8000${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function fetchJobs(filters: Record<string, string>): Promise<JobsResponse> {
  const query = new URLSearchParams(filters).toString();
  return api<JobsResponse>(`/api/v1/search/jobs?${query}`);
}

export async function fetchJobChanges(jobId: string): Promise<JobChange[]> {
  return api<JobChange[]>(`/api/v1/jobs/${jobId}/changes`);
}
