import axios from 'axios';

export interface HealthResponse {
  status: 'ok';
  service: 'leccor-finance-flow-api';
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await axios.get<HealthResponse>('/api/v1/health');
  return response.data;
}
