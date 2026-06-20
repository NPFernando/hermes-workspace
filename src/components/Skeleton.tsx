import React from 'react';
import './Skeleton.css';

type SkeletonProps = {
  className?: string;
  width?: string;
  height?: string;
  radius?: string;
};

const Skeleton = ({ className = '', width = '100%', height = '100%', radius = '4px' }: SkeletonProps) => {
  return (
    <div
      className={["skeleton-loader", className].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius }}
    ></div>
  );
};

export default Skeleton;
