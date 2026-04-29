import { LoaderCircle } from "lucide-react";
import React from "react";

export const LoadingComponent = () => {
    return <div className="non-notes-content">
        <LoaderCircle className="rotate" size={50} />
        <p>Loading...</p></div>;
};