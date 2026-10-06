import { Navigate, Route, Routes } from 'react-router-dom'
import DiagramEditor from '../pages/DiagramEditor'
import FurnitureIndex from '../pages/FurnitureIndex'
import JointDetail from '../pages/JointDetail'
import JointList from '../pages/JointList'
import ProofEditor from '../pages/ProofEditor'
import ProofIndex from '../pages/ProofIndex'
import ProofVersion from '../pages/ProofVersion'
import StepBoard from '../pages/StepBoard'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/joints" replace />} />
      <Route path="/joints" element={<JointList />} />
      <Route path="/joints/:id" element={<JointDetail />} />
      <Route path="/joints/:id/steps" element={<StepBoard />} />
      <Route path="/joints/:id/diagram" element={<DiagramEditor />} />
      <Route path="/furniture" element={<FurnitureIndex />} />
      <Route path="/proof" element={<ProofIndex />} />
      <Route path="/proof/:id" element={<ProofEditor />} />
      <Route path="/proof/version/:id" element={<ProofVersion />} />
      <Route path="*" element={<Navigate to="/joints" replace />} />
    </Routes>
  )
}
