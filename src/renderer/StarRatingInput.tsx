import { UNRATED } from '../domain/modelRating.js';

type Props = {
  value: number;
  disabled?: boolean;
  onChange: (rating: number) => void;
};

/**
 * Interactive 5-star rating with half-star steps.
 * Click left half of star N → N−0.5; right half → N.
 */
export function StarRatingInput({ value, disabled, onChange }: Props) {
  const rating = value > 0 ? value : 0;

  return (
    <div className="star-rating" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill =
          rating >= star ? 1 : rating >= star - 0.5 ? 0.5 : 0;
        return (
          <span key={star} className="star-rating-star">
            <button
              type="button"
              className="star-rating-half left"
              disabled={disabled}
              aria-label={`${star - 0.5} stars`}
              onClick={() => onChange(star - 0.5)}
            />
            <button
              type="button"
              className="star-rating-half right"
              disabled={disabled}
              aria-label={`${star} stars`}
              onClick={() => onChange(star)}
            />
            <span
              className={`star-rating-glyph${
                fill === 1 ? ' full' : fill === 0.5 ? ' half' : ''
              }`}
              aria-hidden
            >
              ★
            </span>
          </span>
        );
      })}
      <button
        type="button"
        className="ghost-btn star-rating-clear"
        disabled={disabled || value < 0}
        title="Clear rating"
        onClick={() => onChange(UNRATED)}
      >
        Clear
      </button>
      <span className="star-rating-label hint">
        {value < 0 ? 'Unrated' : `${value.toFixed(1)} / 5`}
      </span>
    </div>
  );
}
